import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

const INITIAL_ATOM_URL = 'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom';

// Buscador específico para estructuras UBL
function findValueDeep(obj, targetKey) {
    if (!obj || typeof obj !== 'object') return null;
    
    // Si encontramos la clave exacta (ignorando namespaces)
    for (const key of Object.keys(obj)) {
        if (key.toLowerCase().endsWith(':' + targetKey.toLowerCase()) || key.toLowerCase() === targetKey.toLowerCase()) {
            const val = obj[key];
            if (val && typeof val === 'object' && val['#text']) return String(val['#text']).trim();
            return String(val).trim();
        }
        if (typeof obj[key] === 'object') {
            const found = findValueDeep(obj[key], targetKey);
            if (found) return found;
        }
    }
    return null;
}

async function sincronizarLicitaciones() {
    console.log(`[${new Date().toISOString()}] Iniciando captura limpia (Filtro 2026)...`);
    
    let currentUrl = INITIAL_ATOM_URL;
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNamespace: true });

    while (currentUrl) {
        try {
            const response = await fetch(currentUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const rawText = await response.text();
            const jsonObj = parser.parse(rawText);
            
            // Localizar entradas (recursivo)
            const entries = findEntriesRecursive(jsonObj);
            if (!entries) break;

            const batch = [];

            for (const entry of entries) {
                // 1. Filtrar fecha (Solo 2026 en adelante)
                const pubDateRaw = findValueDeep(entry, 'Published') || findValueDeep(entry, 'IssueDate');
                const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
                if (!pubDate || pubDate.getFullYear() < 2026) continue;

                // 2. Extracción limpia
                const rawTitle = findValueDeep(entry, 'Title') || '';
                // Regex para limpiar "Id licitación: XXXX; " y quedarse solo con el objeto
                const objetoContrato = rawTitle.replace(/Id licitación: [^;]+; /i, '').substring(0, 500);
                
                const numExpediente = findValueDeep(entry, 'ContractFolderID') || 'S/N';
                const tipoContrato = findValueDeep(entry, 'ContractTypeCode');
                const cpv = findValueDeep(entry, 'ItemClassificationCode');
                const fechaFin = findValueDeep(entry, 'SubmissionDeadlineDate') || findValueDeep(entry, 'Deadline');
                const provincia = findValueDeep(entry, 'CitySubdivisionName') || findValueDeep(entry, 'Province');
                const url = findValueDeep(entry, 'link') || '';
                
                const presupuestoRaw = findValueDeep(entry, 'TotalAmount') || findValueDeep(entry, 'TaxExclusiveAmount');
                const presupuesto = presupuestoRaw ? parseFloat(presupuestoRaw.replace(',', '.')) : null;

                batch.push({
                    num_expediente: numExpediente,
                    objeto_contrato: objetoContrato,
                    presupuesto_base: !isNaN(presupuesto) ? presupuesto : null,
                    tipo_contrato: tipoContrato,
                    codigo_cpv: cpv,
                    fecha_fin_oferta: fechaFin ? new Date(fechaFin).toISOString() : null,
                    provincia: provincia,
                    url_licitacion: url,
                    origen: 'PLACSP',
                    created_at: new Date().toISOString()
                });
            }

            if (batch.length > 0) {
                await supabase.from('licitaciones').upsert(batch, { onConflict: 'url_licitacion' });
            }

            // Paginación
            currentUrl = getNextPageUrl(jsonObj);
            if (!currentUrl) break;
        } catch (e) { console.error(e); break; }
    }
}

function findEntriesRecursive(obj) {
    if (obj.entry) return Array.isArray(obj.entry) ? obj.entry : [obj.entry];
    for (let key in obj) if (typeof obj[key] === 'object') {
        const found = findEntriesRecursive(obj[key]);
        if (found) return found;
    }
    return null;
}

function getNextPageUrl(jsonObj) {
    const links = jsonObj.feed?.link || jsonObj.feed?.link || [];
    const linkArray = Array.isArray(links) ? links : [links];
    return linkArray.find(l => l['@_rel'] === 'next')?.['@_href'];
}

sincronizarLicitaciones();
