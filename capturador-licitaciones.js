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

// Función auxiliar robusta para extraer texto limpio de cualquier nodo XML parseado
function extractText(node) {
    if (node === null || node === undefined) return null;
    if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
    if (Array.isArray(node)) {
        return node.length > 0 ? extractText(node[0]) : null;
    }
    if (typeof node === 'object') {
        if (node['#text'] !== undefined) return String(node['#text']).trim();
        for (const key of Object.keys(node)) {
            if (!key.startsWith('@_')) {
                const res = extractText(node[key]);
                if (res !== null) return res;
            }
        }
    }
    return null;
}

// Mapeo de códigos numéricos oficiales a nombres legibles de tipos de contrato
function mapTipoContrato(code) {
    if (!code) return null;
    const c = String(code).trim();
    const mapa = {
        '1': 'Obras',
        '2': 'Concesión de obras',
        '3': 'Concesión de servicios',
        '21': 'Suministros',
        '31': 'Servicios',
        '40': 'Privado',
        'Obras': 'Obras',
        'Suministros': 'Suministros',
        'Servicios': 'Servicios'
    };
    return mapa[c] || c;
}

async function ejecutarCaptura() {
    console.log("Iniciando descarga del feed ATOM oficial...");

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

        console.log("Parseando contenido XML del feed...");
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const jsonObj = parser.parse(xmlData);

        const entries = jsonObj.feed?.entry || [];
        const listaEntradas = Array.isArray(entries) ? entries : [entries];

        console.log(`Se han encontrado ${listaEntradas.length} elementos en el feed. Procesando registros...`);

        const licitacionesParaGuardar = [];

        for (const entry of listaEntradas) {
            const status = entry['cac-place-ext:ContractFolderStatus'] || {};
            const project = status['cac:ProcurementProject'] || {};
            const processNode = status['cac:TenderingProcess'] || {};

            // 1. Número de expediente
            const numExpediente = extractText(
                status['cbc:ContractFolderID'] || 
                entry['cbc:ContractFolderID'] || 
                entry.id
            );

            // 2. Objeto del contrato
            const objeto = extractText(
                project['cbc:Name'] || 
                status['cbc:Name'] || 
                entry.title
            ) || 'Sin objeto especificado';

            // 3. Presupuesto base
            let presupuesto = null;
            const budgetNode = project['cbc:BudgetAmount'] || status['cbc:BudgetAmount'] || project['cac:BudgetAmount'];
            if (budgetNode) {
                const rawVal = extractText(
                    budgetNode['cbc:TaxExclusiveAmount'] || 
                    budgetNode['cbc:TotalAmount'] || 
                    budgetNode
                );
                if (rawVal) {
                    const parsed = parseFloat(rawVal);
                    if (!isNaN(parsed)) presupuesto = parsed;
                }
            }

            // 4. Tipo de contrato (con mapeo de códigos)
            const rawTipo = extractText(project['cbc:TypeCode'] || status['cbc:TypeCode']);
            const tipoContrato = mapTipoContrato(rawTipo);

            // 5. Código CPV
            const codigoCpv = extractText(project['cac:RequiredCommodityClassification']?.['cbc:ItemClassificationCode']);

            // 6. Fecha fin de oferta (ampliando rutas de búsqueda)
            const fechaFin = extractText(
                status['cac:TenderSubmissionDeadlinePeriod']?.['cbc:EndDate'] ||
                processNode['cac:TenderSubmissionDeadlinePeriod']?.['cbc:EndDate'] ||
                entry['cac:TenderSubmissionDeadlinePeriod']?.['cbc:EndDate'] ||
                status['cbc:EndDate']
            );

            // 7. Provincia
            const addressNode = status['cac-place-ext:LocatedContractingParty']?.['cac:Party']?.['cac:PostalAddress'];
            const provincia = extractText(addressNode?.['cbc:CountrySubentity'] || addressNode?.['cbc:CityName']);

            // 8. Estado oficial
            const estado = extractText(status['cbc:ContractFolderStatusCode']) || 'Publicada';

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

        console.log(`¡Proceso completado con éxito! Sincronizados y enriquecidos ${licitacionesParaGuardar.length} registros en Supabase.`);

    } catch (err) {
        console.error("Error crítico durante la ejecución del script:", err);
        process.exit(1);
    }
}

ejecutarCaptura();
