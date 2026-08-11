/**
 * capturador-licitaciones.js
 * Script adaptado al esquema real de Supabase para la sincronización con OpenPLACSP.
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

function getSubValue(obj, fieldName) {
    if (!obj || typeof obj !== 'object') return '';
    const val = obj[fieldName];
    if (!val) return '';
    if (typeof val === 'string' || typeof val === 'number') return String(val);
    if (val['#text']) return String(val['#text']);
    return '';
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

async function sincronizarLicitaciones() {
    console.log(`[${new Date().toISOString()}] Iniciando sincronización con OpenPLACSP Atom...`);
    
    let currentUrl = INITIAL_ATOM_URL;
    let allEntries = [];
    let pagesProcessed = 0;
    const maxPages = 30;

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
        const urlLicitacion = getLinkHref(entry, 'alternate') || getSubValue(entry, 'link');
        const titulo = getSubValue(entry, 'title');
        const summary = getSubValue(entry, 'summary') || getSubValue(entry, 'description');

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
            // Extraer o asignar valores básicos compatibles con las columnas de tu tabla
            const nuevaLicitacion = {
                num_expediente: getSubValue(entry, 'id') ? getSubValue(entry, 'id').split('/').pop() : 'S/N',
                objeto_contrato: titulo || summary || 'Sin objeto',
                presupuesto_base: null,
                tipo_contrato: null,
                codigo_cpv: null,
                estado_oficial: 'Publicada',
                url_licitacion: urlLicitacion,
                fecha_fin_oferta: null,
                provincia: null,
                origen: 'PLACSP',
                created_at: new Date().toISOString()
            };

            const { error: insertError } = await supabase
                .from('licitaciones')
                .insert([nuevaLicitacion]);

            if (insertError) {
                console.error(`Error insertando licitación:`, insertError.message);
            } else {
                stats.inserted++;
            }
        } else {
            stats.skipped++;
        }
    }

    console.log('Sincronización finalizada correctamente.');
    console.log(`Resumen: ${stats.inserted} insertadas, ${stats.skipped} ya existentes (omitidas).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    sincronizarLicitaciones();
}

export { sincronizarLicitaciones };
