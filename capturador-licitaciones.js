import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error crítico: Faltan credenciales de Supabase en las variables de entorno.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

const INITIAL_ATOM_URL = 'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom';

function findValueDeep(obj, targetKey) {
    if (!obj || typeof obj !== 'object') return null;
    
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

function findEntriesRecursive(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.entry) return Array.isArray(obj.entry) ? obj.entry : [obj.entry];
    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            const found = findEntriesRecursive(obj[key]);
            if (found) return found;
        }
    }
    return null;
}

function getNextPageUrl(jsonObj) {
    try {
        let feed = jsonObj.feed;
        if (!feed) {
            const rootKey = Object.keys(jsonObj).find(k => k && k !== '?xml');
            feed = rootKey ? jsonObj[rootKey] : null;
        }
        if (!feed || !feed.link) return null;
        const links = Array.isArray(feed.link) ? feed.link : [feed.link];
        const nextLink = links.find(l => l && l['@_rel'] === 'next');
        return nextLink ? nextLink['@_href'] : null;
    } catch (e) { return null; }
}

async function sincronizarLicitaciones() {
    console.log(`[${new Date().toISOString()}] Iniciando sincronización con trazas detalladas...`);
    
    let currentUrl = INITIAL_ATOM_URL;
    let pageCount = 0;
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNamespace: true });
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

    while (currentUrl) {
        pageCount++;
        console.log(`\n--- Procesando Página ${pageCount} ---`);
        console.log(`URL: ${currentUrl}`);

        try {
            console.log('Descargando feed XML...');
            const response = await fetch(currentUrl, { headers, redirect: 'follow' });
            
            if (!response.ok) {
                console.error(`Error HTTP ${response.status} al descargar la página.`);
                break;
            }

            const rawText = await response.text();
            console.log(`Descarga completa. Tamaño recibido: ${(rawText.length / 1024 / 1024).toFixed(2)} MB`);

            if (rawText.trim().startsWith('<!DOCTYPE') || rawText.includes('<html')) {
                console.error('El servidor devolvió HTML en lugar de XML (posible bloqueo o error 404/503).');
                break;
            }

            console.log('Parseando XML a JSON...');
            const parseStart = Date.now();
            const jsonObj = parser.parse(rawText);
            console.log(`Parseo completado en ${(Date.now() - parseStart) / 1000}s`);

            const entries = findEntriesRecursive(jsonObj);
            if (!entries || entries.length === 0) {
                console.log('No se encontraron entradas (entry) en esta página.');
                break;
            }

            console.log(`Se encontraron ${entries.length} entradas en el feed. Filtrando y mapeando...`);
            
            const batchMap = new Map();
            let skippedOld = 0;

            for (const entry of entries) {
                const pubDateRaw = findValueDeep(entry, 'Published') || findValueDeep(entry, 'IssueDate');
                const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
                
                // Filtro estricto 2026
                if (!pubDate || isNaN(pubDate.getTime()) || pubDate.getFullYear() < 2026) {
                    skippedOld++;
                    continue;
                }

                const rawTitle = findValueDeep(entry, 'Title') || '';
                const objetoContrato = rawTitle.replace(/Id licitación: [^;]+; /i, '').substring(0, 500);
                
                const numExpediente = findValueDeep(entry, 'ContractFolderID') || 'S/N';
                const tipoContrato = findValueDeep(entry, 'ContractTypeCode');
                const cpv = findValueDeep(entry, 'ItemClassificationCode');
                const fechaFin = findValueDeep(entry, 'SubmissionDeadlineDate') || findValueDeep(entry, 'Deadline');
                const provincia = findValueDeep(entry, 'CitySubdivisionName') || findValueDeep(entry, 'Province');
                const url = findValueDeep(entry, 'link') || '';
                
                const presupuestoRaw = findValueDeep(entry, 'TotalAmount') || findValueDeep(entry, 'TaxExclusiveAmount');
                const presupuesto = presupuestoRaw ? parseFloat(presupuestoRaw.replace(',', '.')) : null;

                if (!url) continue;

                batchMap.set(url, {
                    num_expediente: numExpediente.substring(0, 255),
                    objeto_contrato: objetoContrato || 'Sin objeto',
                    presupuesto_base: !isNaN(presupuesto) ? presupuesto : null,
                    tipo_contrato: tipoContrato ? tipoContrato.substring(0, 100) : null,
                    codigo_cpv: cpv ? cpv.substring(0, 50) : null,
                    estado_oficial: 'Publicada', // o el mapeo que prefieras
                    fecha_fin_oferta: fechaFin ? new Date(fechaFin).toISOString() : null,
                    provincia: provincia ? provincia.substring(0, 100) : null,
                    url_licitacion: url,
                    origen: 'PLACSP',
                    created_at: new Date().toISOString()
                });
            }

            const batch = Array.from(batchMap.values());
            console.log(`Filtro aplicado -> Omitidos (<2026): ${skippedOld} | Válidos para guardar: ${batch.length}`);

            if (batch.length > 0) {
                console.log('Enviando lote a Supabase...');
                const { error: upsertError } = await supabase
                    .from('licitaciones')
                    .upsert(batch, { onConflict: 'url_licitacion' });

                if (upsertError) {
                    console.error('Error al insertar en Supabase:', upsertError.message);
                } else {
                    console.log('¡Lote guardado en Supabase con éxito!');
                }
            }

            currentUrl = getNextPageUrl(jsonObj);
            if (!currentUrl) {
                console.log('No hay más páginas siguientes. Sincronización completada.');
                break;
            }
            console.log(`Siguiente página detectada: ${currentUrl}`);

        } catch (error) {
            console.error('Excepción atrapada en el ciclo:', error);
            break;
        }
    }
}

sincronizarLicitaciones();
