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

// Función auxiliar robusta para extraer texto limpio de cualquier nodo
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

// Buscador recursivo profundo para encontrar una etiqueta específica en cualquier nivel del XML
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

// Mapeo exhaustivo de códigos oficiales de tipo de contrato
function mapTipoContrato(code, rawEntry) {
    // Si el propio texto ya viene descrito
    if (code &&isNaN(code)) {
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
        '50': 'Servicios', // Homologación estándar para códigos genéricos de servicios/asistencias
        '11': 'Obras',
        '22': 'Suministros',
        '32': 'Servicios'
    };
    
    return mapa[c] || (c ? `Servicios / Otro (${c})` : 'Servicios');
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

        console.log(`Procesando ${listaEntradas.length} registros con extracción profunda...`);

        const licitacionesParaGuardar = [];

        for (const entry of listaEntradas) {
            const status = entry['cac-place-ext:ContractFolderStatus'] || {};
            const project = status['cac:ProcurementProject'] || {};

            // 1. Número de expediente (Búsqueda profunda garantizada)
            const numExpediente = extractText(
                status['cbc:ContractFolderID'] || 
                entry['cbc:ContractFolderID'] || 
                findDeep(entry, 'cbc:ContractFolderID') ||
                entry.id
            );

            // 2. Objeto del contrato
            const objeto = extractText(
                project['cbc:Name'] || 
                status['cbc:Name'] || 
                findDeep(entry, 'cbc:Name') ||
                entry.title
            ) || 'Sin objeto especificado';

            // 3. Presupuesto base (Búsqueda profunda en montos)
            let presupuesto = null;
            const rawPresupuesto = findDeep(status, 'cbc:TaxExclusiveAmount') || 
                                   findDeep(status, 'cbc:TotalAmount') || 
                                   findDeep(project, 'cbc:TaxExclusiveAmount') ||
                                   findDeep(project, 'cbc:TotalAmount');
            if (rawPresupuesto) {
                const parsed = parseFloat(rawPresupuesto.replace(',', '.'));
                if (!isNaN(parsed)) presupuesto = parsed;
            }

            // 4. Tipo de contrato
            const rawTipo = extractText(project['cbc:TypeCode'] || status['cbc:TypeCode'] || findDeep(entry, 'cbc:TypeCode'));
            const tipoContrato = mapTipoContrato(rawTipo, entry);

            // 5. Código CPV (Búsqueda profunda de clasificación)
            const codigoCpv = extractText(
                project['cac:RequiredCommodityClassification']?.['cbc:ItemClassificationCode'] ||
                findDeep(entry, 'cbc:ItemClassificationCode')
            );

            // 6. Fecha fin de oferta (Búsqueda profunda en plazos de presentación)
            const fechaFin = extractText(
                status['cac:TenderSubmissionDeadlinePeriod']?.['cbc:EndDate'] ||
                findDeep(entry, 'TenderSubmissionDeadlinePeriod')?.['cbc:EndDate'] ||
                findDeep(entry, 'cbc:EndDate')
            );

            // 7. Ubicación combinada (Provincia + Localidad/Pueblo)
            const addressNode = status['cac-place-ext:LocatedContractingParty']?.['cac:Party']?.['cac:PostalAddress'] || findDeep(entry, 'cac:PostalAddress');
            const provinciaOficial = extractText(addressNode?.['cbc:CountrySubentity']);
            const localidadOficial = extractText(addressNode?.['cbc:CityName']);

            let ubicacionFinal = null;
            if (provinciaOficial && localidadOficial) {
                // Si tenemos ambos, los unimos para que el filtro capture los dos
                ubicacionFinal = provinciaOficial.toLowerCase() === localidadOficial.toLowerCase() 
                    ? provinciaOficial 
                    : `${provinciaOficial} (${localidadOficial})`;
            } else {
                ubicacionFinal = provinciaOficial || localidadOficial || 'No especificada';
            }

            // 8. Estado oficial
            const estado = extractText(status['cbc:ContractFolderStatusCode'] || findDeep(entry, 'cbc:ContractFolderStatusCode')) || 'Publicada';

            // 9. URL de la licitación
            let urlLicitacion = '';
            if (entry.link) {
                if (Array.isArray(entry.link)) {
                    const linkObj = entry.link.find(l => l['@_rel'] === 'alternate' || !l['@_rel']) || entry.link[0];
                    urlLicitacion = extractText(linkObj?.['@_href']) || '';
                } else if (typeof entry.link === 'object') {
                    urlLicitacion = extractText(entry.link['@_href']) || '';
                }
            }

            if (numExpediente) {
                licitacionesParaGuardar.push({
                    num_expediente: numExpediente,
                    objeto_contrato: objeto,
                    presupuesto_base: presupuesto,
                    tipo_contrato: tipoContrato,
                    codigo_cpv: codigoCpv,
                    fecha_fin_oferta: fechaFin ? new Date(fechaFin).toISOString() : null,
                    provincia: provincia,
                    estado_oficial: estado,
                    url_licitacion: urlLicitacion,
                    origen: 'PLACSP'
                });
            }
        }

        if (licitacionesParaGuardar.length === 0) {
            console.log("No hay licitaciones válidas para insertar en este lote.");
            return;
        }

        const tamanoLote = 500;
        for (let i = 0; i < licitacionesParaGuardar.length; i += tamanoLote) {
            const lote = licitacionesParaGuardar.slice(i, i + tamanoLote);

            const { error } = await supabase
                .from('licitaciones')
                .upsert(lote, { onConflict: 'num_expediente' });

            if (error) {
                console.error(`Error al guardar el lote ${i} en Supabase:`, error);
            }
        }

        console.log(`¡Sincronización perfecta completada! ${licitacionesParaGuardar.length} registros enriquecidos.`);

    } catch (err) {
        console.error("Error crítico durante la ejecución del script:", err);
        process.exit(1);
    }
}

ejecutarCaptura();
