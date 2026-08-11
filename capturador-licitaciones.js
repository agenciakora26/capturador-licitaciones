import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Faltan las credenciales de Supabase en las variables de entorno.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: { transport: ws }
});

const ATOM_URL = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";

function extractText(node) {
    if (node === null || node === undefined) return null;
    if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
    if (Array.isArray(node)) {
        for (const item of node) {
            const res = extractText(item);
            if (res) return res;
        }
        return null;
    }
    if (typeof node === 'object') {
        if (node['#text'] !== undefined && node['#text'] !== null) return String(node['#text']).trim();
        for (const key of Object.keys(node)) {
            if (!key.startsWith('@_')) {
                const res = extractText(node[key]);
                if (res !== null) return res;
            }
        }
    }
    return null;
}

function findDeep(obj, targetKey) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj[targetKey] !== undefined) {
        const val = extractText(obj[targetKey]);
        if (val) return val;
    }
    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
            const found = findDeep(obj[key], targetKey);
            if (found) return found;
        }
    }
    return null;
}

function mapTipoContrato(code) {
    if (code && isNaN(code)) {
        const text = String(code).toLowerCase();
        if (text.includes('obra')) return 'Obras';
        if (text.includes('suministro')) return 'Suministros';
        if (text.includes('servicio')) return 'Servicios';
        if (text.includes('gestion') || text.includes('concesion')) return 'Concesión de servicios';
    }

    const c = String(code || '').trim();
    const mapa = {
        '1': 'Obras',
        '2': 'Concesión de obras',
        '3': 'Concesión de servicios',
        '21': 'Suministros',
        '31': 'Servicios',
        '40': 'Privado',
        '50': 'Servicios',
        '11': 'Obras',
        '22': 'Suministros',
        '32': 'Servicios'
    };
    
    return mapa[c] || (c ? `Servicios / Otro (${c})` : 'Servicios');
}

async function obtenerExpedientesExistentes() {
    const expedientesSet = new Set();
    let rangeStart = 0;
    const rangeStep = 1000;
    
    while (true) {
        const { data, error } = await supabase
            .from('licitaciones')
            .select('num_expediente')
            .range(rangeStart, rangeStart + rangeStep - 1);
            
        if (error || !data || data.length === 0) break;
        data.forEach(row => expedientesSet.add(row.num_expediente));
        if (data.length < rangeStep) break;
        rangeStart += rangeStep;
    }
    return expedientesSet;
}

async function ejecutarCaptura() {
    console.log("Iniciando descarga y análisis profundo del feed ATOM oficial...");

    try {
        const response = await fetch(ATOM_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'application/atom+xml,application/xml,text/xml,*/*'
            }
        });

        if (!response.ok) {
            throw new Error(`Error HTTP del servidor oficial: ${response.status} - ${response.statusText}`);
        }

        const xmlData = await response.text();

        if (!xmlData || xmlData.trim().startsWith('<html') || xmlData.includes('Redireccionando')) {
            throw new Error("El contenido recibido no es un XML válido (posible bloqueo o redirección).");
        }

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const jsonObj = parser.parse(xmlData);

        const entries = jsonObj.feed?.entry || [];
        const listaEntradas = Array.isArray(entries) ? entries : [entries];

        console.log("Consultando registros existentes en Supabase...");
        const expedientesExistentes = await obtenerExpedientesExistentes();

        const licitacionesParaGuardar = [];

        for (const entry of listaEntradas) {
            const status = entry['cac-place-ext:ContractFolderStatus'] || {};
            const project = status['cac:ProcurementProject'] || {};

            const numExpediente = extractText(
                status['cbc:ContractFolderID'] || 
                entry['cbc:ContractFolderID'] || 
                findDeep(entry, 'cbc:ContractFolderID') ||
                entry.id
            );

            // Si ya lo tenemos registrado en Supabase, nos lo saltamos directamente
            if (!numExpediente || expedientesExistentes.has(numExpediente)) {
                continue;
            }

            const objeto = extractText(
                project['cbc:Name'] || 
                status['cbc:Name'] || 
                findDeep(entry, 'cbc:Name') ||
                entry.title
            ) || 'Sin objeto especificado';

            let presupuesto = null;
            const rawPresupuesto = findDeep(status, 'cbc:TaxExclusiveAmount') || 
                                   findDeep(status, 'cbc:TotalAmount') || 
                                   findDeep(project, 'cbc:TaxExclusiveAmount') ||
                                   findDeep(project, 'cbc:TotalAmount');
            if (rawPresupuesto) {
                const parsed = parseFloat(rawPresupuesto.replace(',', '.'));
                if (!isNaN(parsed)) presupuesto = parsed;
            }

            const rawTipo = extractText(project['cbc:TypeCode'] || status['cbc:TypeCode'] || findDeep(entry, 'cbc:TypeCode'));
            const tipoContrato = mapTipoContrato(rawTipo);

            const codigoCpv = extractText(
                project['cac:RequiredCommodityClassification']?.['cbc:ItemClassificationCode'] ||
                findDeep(entry, 'cbc:ItemClassificationCode')
            );

            const fechaFin = extractText(
                status['cac:TenderSubmissionDeadlinePeriod']?.['cbc:EndDate'] ||
                findDeep(entry, 'TenderSubmissionDeadlinePeriod')?.['cbc:EndDate'] ||
                findDeep(entry, 'cbc:EndDate')
            );

            const addressNode = status['cac-place-ext:LocatedContractingParty']?.['cac:Party']?.['cac:PostalAddress'] || 
                                project['cac:PostalAddress'] || 
                                findDeep(status, 'cac:PostalAddress');

            let provinciaOficial = addressNode ? extractText(addressNode['cbc:CountrySubentity']) : null;
            if (!provinciaOficial) {
                provinciaOficial = findDeep(status, 'cbc:CountrySubentity');
            }

            let localidadOficial = addressNode ? extractText(addressNode['cbc:CityName']) : null;
            if (!localidadOficial) {
                localidadOficial = findDeep(status, 'cbc:CityName');
            }

            let ubicacionFinal = null;
            if (provinciaOficial && localidadOficial) {
                if (provinciaOficial.toLowerCase() === localidadOficial.toLowerCase()) {
                    ubicacionFinal = provinciaOficial;
                } else {
                    ubicacionFinal = `${provinciaOficial} (${localidadOficial})`;
                }
            } else {
                ubicacionFinal = provinciaOficial || localidadOficial || null;
            }

            const estado = extractText(status['cbc:ContractFolderStatusCode'] || findDeep(entry, 'cbc:ContractFolderStatusCode')) || 'Publicada';

            let urlLicitacion = '';
            if (entry.link) {
                if (Array.isArray(entry.link)) {
                    const linkObj = entry.link.find(l => l['@_rel'] === 'alternate' || !l['@_rel']) || entry.link[0];
                    urlLicitacion = extractText(linkObj?.['@_href']) || '';
                } else if (typeof entry.link === 'object') {
                    urlLicitacion = extractText(entry.link['@_href']) || '';
                }
            }

            licitacionesParaGuardar.push({
                num_expediente: numExpediente,
                objeto_contrato: objeto,
                presupuesto_base: presupuesto,
                tipo_contrato: tipoContrato,
                codigo_cpv: codigoCpv,
                fecha_fin_oferta: fechaFin ? new Date(fechaFin).toISOString() : null,
                provincia: ubicacionFinal,
                estado_oficial: estado,
                url_licitacion: urlLicitacion,
                origen: 'PLACSP'
            });
        }

        if (licitacionesParaGuardar.length === 0) {
            console.log("ℹ️ No hay licitaciones nuevas. Todo está al día.");
            return;
        }

        const tamanoLote = 500;
        for (let i = 0; i < licitacionesParaGuardar.length; i += tamanoLote) {
            const lote = licitacionesParaGuardar.slice(i, i + tamanoLote);
            await supabase.from('licitaciones').upsert(lote, { onConflict: 'num_expediente' });
        }

        console.log(`¡Sincronización completada! ${licitacionesParaGuardar.length} nuevas licitaciones añadidas.`);

    } catch (err) {
        console.error("Error crítico durante la ejecución del script:", err);
        process.exit(1);
    }
}

ejecutarCaptura();
