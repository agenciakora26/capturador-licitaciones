/**
 * capturador-licitaciones.js
 * Script mejorado para la extracción completa de licitaciones y estados desde OpenPLACSP Atom.
 */

import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error crítico: Faltan las variables de entorno de Supabase (SUPABASE_URL y SUPABASE_KEY).');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

const INITIAL_ATOM_URL = 'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom';

// Función auxiliar para buscar valores de forma recursiva sin importar mayúsculas/minúsculas o anidación
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
    if (obj.entry) {
        return Array.isArray(obj.entry) ? obj.entry : [obj.entry];
    }
    if (obj.item) {
        return Array.isArray(obj.item) ? obj.item : [obj.item];
    }
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
    } catch (e) {
        return null;
    }
}

// Mapeador de códigos o estados oficiales de PLACSP a los valores de tu desplegable
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
    console.log(`[${new Date().toISOString()}] Iniciando sincronización avanzada con OpenPLACSP Atom...`);
    
    let currentUrl = INITIAL_ATOM_URL;
    let allEntries = [];
    let pagesProcessed = 0;
    const maxPages = 5; // Ajustable según necesidad

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        removeNamespace: true
    });

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/atom+xml, application/xml, text/xml, */*'
    };

    while (currentUrl && pagesProcessed < maxPages) {
        try {
            console.log(`Consultando página [${pagesProcessed + 1}]: ${currentUrl}`);
            const response = await fetch(currentUrl, { method: 'GET', headers, redirect: 'follow' });

            if (!response.ok) {
                console.error(`Error HTTP ${response.status} al consultar la página.`);
                break;
            }

            const rawText = await response.text();
            if (rawText.trim().toLowerCase().startsWith('<!doctype html>') || rawText.includes('<html')) {
                console.error('El servidor ha devuelto HTML en lugar del feed XML.');
                break;
            }

            const jsonObj = parser.parse(rawText);
            const entries = findEntriesRecursive(jsonObj);

            if (entries && entries.length > 0) {
                allEntries = allEntries.concat(entries);
            }

            const nextUrl = getNextPageUrl(jsonObj);
            if (nextUrl && nextUrl !== currentUrl) {
                currentUrl = nextUrl;
                pagesProcessed++;
            } else {
                break;
            }
        } catch (error) {
            console.error('Error durante la paginación del feed:', error.message);
            break;
        }
    }

    console.log(`Total de entradas obtenidas del feed: ${allEntries.length}`);

    let stats = { inserted: 0, skipped: 0 };

    for (const entry of allEntries) {
        const urlLicitacion = getLinkHref(entry, 'alternate') || findValueDeep(entry, ['link', 'id']);
        const titulo = findValueDeep(entry, ['title', 'summary', 'description']);

        if (!urlLicitacion) continue;

        // Comprobar si la licitación ya existe basándonos en su URL única
        const { data: existing, error: selectError } = await supabase
            .from('licitaciones')
            .select('id, url_licitacion')
            .eq('url_licitacion', urlLicitacion)
            .single();

        if (selectError && selectError.code !== 'PGRST116') {
            console.error(`Error consultando Supabase para URL ${urlLicitacion}:`, selectError.message);
            continue;
        }

        if (!existing) {
            // Extracción profunda de campos específicos de PLACSP
            const numExpediente = findValueDeep(entry, ['contractFolderID', 'id', ' expediente']) || 'S/N';
            const presupuestoRaw = findValueDeep(entry, ['totalAmount', 'taxExclusiveAmount', 'budgetAmount', 'presupuesto']);
            const presupuestoBase = presupuestoRaw ? parseFloat(presupuestoRaw.replace(',', '.')) : null;
            
            const tipoContrato = findValueDeep(entry, ['contractTypeCode', 'type', 'tipoContrato']) || null;
            const codigoCpv = findValueDeep(entry, ['itemClassificationCode', 'cpv', 'codigoCPV']) || null;
            
            const estadoRaw = findValueDeep(entry, ['contractFolderStatusCode', 'status', 'state', 'estadoLicitacion']);
            const estadoOficial = mapearEstadoOficial(estadoRaw);

            const fechaFinRaw = findValueDeep(entry, ['endDate', 'submissionDeadlineDate', 'fechaFinOferta', 'deadline']);
            const fechaFinOferta = fechaFinRaw ? new Date(fechaFinRaw).toISOString() : null;

            const provincia = findValueDeep(entry, ['province', 'citySubdivisionName', 'territory', 'provincia']) || null;

            const nuevaLicitacion = {
                num_expediente: numExpediente.length > 100 ? numExpediente.substring(0, 100) : numExpediente,
                objeto_contrato: titulo || 'Sin objeto',
                presupuesto_base: !isNaN(presupuestoBase) ? presupuestoBase : null,
                tipo_contrato: tipoContrato,
                codigo_cpv: codigoCpv,
                estado_oficial: estadoOficial,
                url_licitacion: urlLicitacion,
                fecha_fin_oferta: fechaFinOferta,
                provincia: provincia,
                origen: 'PLACSP',
                created_at: new Date().toISOString()
            };

            const { error: insertError } = await supabase
                .from('licitaciones')
                .insert([nuevaLicitacion]);

            if (insertError) {
                console.error(`Error insertando licitación (${nuevaLicitacion.num_expediente}):`, insertError.message);
            } else {
                stats.inserted++;
            }
        } else {
            stats.skipped++;
        }
    }

    console.log('Sincronización de licitaciones finalizada correctamente.');
    console.log(`Resumen: ${stats.inserted} insertadas, ${stats.skipped} ya existentes (omitidas).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    sincronizarLicitaciones();
}

export { sincronizarLicitaciones };
