/**
 * capturador-licitaciones.js
 * Script definitivo optimizado: Procesamiento por páginas para evitar errores de memoria (OOM).
 */

import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error crítico: Faltan las variables de entorno de Supabase.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

const INITIAL_ATOM_URL = 'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom';

// Función auxiliar para búsqueda profunda de nodos XML
function findValueDeep(obj, targetKeys) {
    if (!obj || typeof obj !== 'object') return null;
    const keys = Array.isArray(targetKeys) ? targetKeys : [targetKeys];
    for (const key of Object.keys(obj)) {
        const lowerKey = key.toLowerCase();
        if (keys.some(tk => lowerKey === tk.toLowerCase())) {
            const val = obj[key];
            if (val !== null && val !== undefined) {
                if (typeof val === 'string' || typeof val === 'number') return String(val).trim();
                if (val['#text']) return String(val['#text']).trim();
            }
        }
        if (typeof obj[key] === 'object') {
            const found = findValueDeep(obj[key], targetKeys);
            if (found !== null && found !== undefined && found !== '') return found;
        }
    }
    return null;
}

function getLinkHref(entry, relType = 'alternate') {
    if (!entry || !entry.link) return '';
    const links = Array.isArray(entry.link) ? entry.link : [entry.link];
    const preferred = links.find(l => l && (l['@_rel'] === relType || (!l['@_rel'] && relType === 'alternate')));
    return preferred ? (preferred['@_href'] || '') : (links[0]['@_href'] || '');
}

function findEntriesRecursive(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.entry) return Array.isArray(obj.entry) ? obj.entry : [obj.entry];
    if (obj.item) return Array.isArray(obj.item) ? obj.item : [obj.item];
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

// Mapeador robusto de estados oficiales de la PLACSP
function mapearEstadoOficial(codigoRaw) {
    if (!codigoRaw) return 'Publicada';
    const val = String(codigoRaw).toUpperCase().trim();
    if (val.includes('PUB') || val.includes('PUBLICADA')) return 'Publicada';
    if (val.includes('EV_PREV') || val.includes('EVALUACION_PREVIA')) return 'Evaluación Previa';
    if (val.includes('EV') || val.includes('EVALUACION')) return 'Evaluación';
    if (val.includes('PLAZO') || val.includes('EN_PLAZO')) return 'Licitaciones en plazo';
    if (val.includes('ADJ_PROV') || val.includes('PROVISIONAL')) return 'Adjudicación Provisional';
    if (val.includes('PARCIALMENTE_ADJ')) return 'Parcialmente Adjudicada';
    if (val.includes('ADJ')) return 'Adjudicada';
    if (val.includes('RES_PARCIAL')) return 'Parcialmente Resuelta';
    if (val.includes('RES') || val.includes('RESUELTA')) return 'Resuelta';
    if (val.includes('DES')) return 'Desistida';
    if (val.includes('ANU')) return 'Anulada';
    if (val.includes('PREV') || val.includes('ANUNCIO_PREVIO')) return 'Anuncio Previo';
    return 'Publicada';
}

async function sincronizarLicitaciones() {
    console.log(`[${new Date().toISOString()}] Iniciando sincronización por lotes página a página...`);
    
    let currentUrl = INITIAL_ATOM_URL;
    let pagesProcessed = 0;
    let stats = { inserted: 0, updated: 0 };

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNamespace: true });
    const headers = { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 
        'Accept': 'application/atom+xml, application/xml, text/xml, */*' 
    };

    // Bucle principal: Descarga y procesa página por página sin acumular en memoria global
    while (currentUrl) {
        try {
            pagesProcessed++;
            console.log(`Consultando y procesando página [${pagesProcessed}]: ${currentUrl}`);
            
            const response = await fetch(currentUrl, { method: 'GET', headers, redirect: 'follow' });
            if (!response.ok) {
                console.error(`Error HTTP ${response.status} en la página ${pagesProcessed}`);
                break;
            }
            
            const rawText = await response.text();
            if (rawText.trim().toLowerCase().startsWith('<!doctype html>') || rawText.includes('<html')) {
                console.error('El servidor ha devuelto HTML en lugar de XML.');
                break;
            }

            const jsonObj = parser.parse(rawText);
            const entries = findEntriesRecursive(jsonObj);

            if (entries && entries.length > 0) {
                for (const entry of entries) {
                    const urlLicitacion = getLinkHref(entry, 'alternate') || findValueDeep(entry, ['link', 'id']);
                    if (!urlLicitacion) continue;

                    // Extracción de datos detallados
                    const titulo = findValueDeep(entry, ['title', 'summary', 'description']);
                    const numExpediente = findValueDeep(entry, ['contractFolderID', 'id', 'expediente']) || 'S/N';
                    const presupuestoRaw = findValueDeep(entry, ['totalAmount', 'taxExclusiveAmount', 'budgetAmount', 'presupuesto']);
                    const presupuestoBase = presupuestoRaw ? parseFloat(presupuestoRaw.replace(',', '.')) : null;
                    const tipoContrato = findValueDeep(entry, ['contractTypeCode', 'type', 'tipoContrato']) || null;
                    const codigoCpv = findValueDeep(entry, ['itemClassificationCode', 'cpv', 'codigoCPV']) || null;
                    const estadoRaw = findValueDeep(entry, ['contractFolderStatusCode', 'status', 'state', 'estadoLicitacion']);
                    const estadoOficial = mapearEstadoOficial(estadoRaw);
                    const fechaFinRaw = findValueDeep(entry, ['endDate', 'submissionDeadlineDate', 'fechaFinOferta', 'deadline']);
                    const fechaFinOferta = fechaFinRaw ? new Date(fechaFinRaw).toISOString() : null;
                    const provincia = findValueDeep(entry, ['province', 'citySubdivisionName', 'territory', 'provincia']) || null;

                    const datosLicitacion = {
                        num_expediente: numExpediente.length > 100 ? numExpediente.substring(0, 100) : numExpediente,
                        objeto_contrato: titulo || 'Sin objeto',
                        presupuesto_base: !isNaN(presupuestoBase) ? presupuestoBase : null,
                        tipo_contrato: tipoContrato,
                        codigo_cpv: codigoCpv,
                        estado_oficial: estadoOficial,
                        url_licitacion: urlLicitacion,
                        fecha_fin_oferta: fechaFinOferta,
                        provincia: provincia,
                        origen: 'PLACSP'
                    };

                    // Comprobar si ya existe en Supabase por su URL única
                    const { data: existing, error: selectError } = await supabase
                        .from('licitaciones')
                        .select('id')
                        .eq('url_licitacion', urlLicitacion)
                        .single();

                    if (selectError && selectError.code !== 'PGRST116') {
                        continue;
                    }

                    if (existing) {
                        // Actualizar si ya existe
                        const { error: updateError } = await supabase
                            .from('licitaciones')
                            .update(datosLicitacion)
                            .eq('id', existing.id);
                        if (!updateError) stats.updated++;
                    } else {
                        // Insertar si es nueva
                        const { error: insertError } = await supabase
                            .from('licitaciones')
                            .insert([{ ...datosLicitacion, created_at: new Date().toISOString() }]);
                        if (!insertError) stats.inserted++;
                    }
                }
            }

            // Obtener la URL de la siguiente página antes de descartar el objeto actual
            const nextUrl = getNextPageUrl(jsonObj);
            if (nextUrl && nextUrl !== currentUrl) {
                currentUrl = nextUrl;
            } else {
                break;
            }
        } catch (error) {
            console.error(`Error procesando la página ${pagesProcessed}:`, error.message);
            break;
        }
    }

    console.log('Sincronización completa finalizada sin desbordamiento.');
    console.log(`Resumen -> Páginas recorridas: ${pagesProcessed} | Nuevas insertadas: ${stats.inserted} | Existentes actualizadas: ${stats.updated}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    sincronizarLicitaciones();
}

export { sincronizarLicitaciones };
