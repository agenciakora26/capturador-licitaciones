/**
 * capturador-licitaciones.js
 * Script definitivo para la captura, paginación y sincronización idempotente 
 * con Supabase utilizando el feed Atom oficial de OpenPLACSP.
 */

import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
// Se corrige el orden para que lea correctamente SUPABASE_KEY del workflow
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error crítico: Faltan las variables de entorno de Supabase (SUPABASE_URL y SUPABASE_KEY).');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// URL oficial del Atom de datos abiertos de la PLACSP
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

    let stats = { inserted: 0, updated: 0, skipped: 0 };

    for (const entry of allEntries) {
        const entryId = getSubValue(entry, 'id') || getSubValue(entry, 'guid') || getLinkHref(entry);
        if (!entryId) continue;

        const title = getSubValue(entry, 'title');
        const updated = getSubValue(entry, 'updated') || getSubValue(entry, 'published') || new Date().toISOString();
        const link = getLinkHref(entry, 'alternate') || getSubValue(entry, 'link');
        const summary = getSubValue(entry, 'summary') || getSubValue(entry, 'description');

        const { data: existing, error: selectError } = await supabase
            .from('licitaciones')
            .select('id, updated')
            .eq('id', entryId)
            .single();

        if (selectError && selectError.code !== 'PGRST116') {
            console.error(`Error consultando Supabase para ID ${entryId}:`, selectError.message);
            continue;
        }

        if (!existing) {
            const { error: insertError } = await supabase
                .from('licitaciones')
                .insert([{
                    id: entryId,
                    title,
                    updated,
                    link,
                    summary,
                    created_at: new Date().toISOString()
                }]);

            if (insertError) {
                console.error(`Error insertando ID ${entryId}:`, insertError.message);
            } else {
                stats.inserted++;
            }
        } else {
            const existingUpdated = new Date(existing.updated).getTime();
            const incomingUpdated = new Date(updated).getTime();

            if (incomingUpdated > existingUpdated) {
                const { error: updateError } = await supabase
                    .from('licitaciones')
                    .update({
                        title,
                        updated,
                        link,
                        summary
                    })
                    .eq('id', entryId);

                if (updateError) {
                    console.error(`Error actualizando ID ${entryId}:`, updateError.message);
                } else {
                    stats.updated++;
                }
            } else {
                stats.skipped++;
            }
        }
    }

    console.log('Sincronización finalizada correctamente.');
    console.log(`Resumen: ${stats.inserted} insertadas, ${stats.updated} actualizadas, ${stats.skipped} sin cambios.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    sincronizarLicitaciones();
}

export { sincronizarLicitaciones };
