/**
 * capturador-licitaciones.js
 * Script definitivo para la captura de licitaciones utilizando el feed público oficial de la PLACSP.
 */

import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.resolve('./processed_ids.json');

// URL del canal de sindicación público general de la PLACSP
const ATOM_URL = 'https://contrataciondelestado.es/sindicacion/sindicacion';

function loadProcessedIds() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = fs.readFileSync(STATE_FILE, 'utf-8');
            return new Set(JSON.parse(data));
        }
    } catch (error) {
        console.error('Error al cargar el archivo de estado de IDs:', error.message);
    }
    return new Set();
}

function saveProcessedIds(processedSet) {
    try {
        const arrayData = Array.from(processedSet);
        fs.writeFileSync(STATE_FILE, JSON.stringify(arrayData, null, 2), 'utf-8');
    } catch (error) {
        console.error('Error al guardar el archivo de estado de IDs:', error.message);
    }
}

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

async function fetchLicitaciones() {
    console.log(`[${new Date().toISOString()}] Conectando con el canal Atom público de la PLACSP...`);
    
    let currentUrl = ATOM_URL;
    let allEntries = [];
    let pagesProcessed = 0;
    const maxPages = 5;

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
                console.error(`Error HTTP ${response.status} en la URL: ${currentUrl}`);
                break;
            }

            const rawText = await response.text();
            if (rawText.trim().toLowerCase().startsWith('<!doctype html>') || rawText.includes('<html')) {
                console.error('El servidor ha respondido con una página HTML en lugar del feed XML.');
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
            console.error('Error durante el recorrido del feed:', error.message);
            break;
        }
    }

    console.log(`Total de entradas recopiladas en la ejecución: ${allEntries.length}`);

    const processedIds = loadProcessedIds();
    const nuevasLicitaciones = [];

    for (const entry of allEntries) {
        const entryId = getSubValue(entry, 'id') || getSubValue(entry, 'guid') || getLinkHref(entry);

        if (entryId && !processedIds.has(entryId)) {
            const licitacion = {
                id: entryId,
                title: getSubValue(entry, 'title'),
                updated: getSubValue(entry, 'updated') || getSubValue(entry, 'pubDate') || getSubValue(entry, 'published') || new Date().toISOString(),
                link: getLinkHref(entry, 'alternate') || getSubValue(entry, 'link'),
                summary: getSubValue(entry, 'summary') || getSubValue(entry, 'description')
            };

            nuevasLicitaciones.push(licitacion);
            processedIds.add(entryId);
        }
    }

     saveProcessedIds(processedIds);

    console.log(`Licitaciones nuevas reales detectadas: ${nuevasLicitaciones.length}`);
    return nuevasLicitaciones;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    fetchLicitaciones().then(nuevas => {
        console.log('Resultado de la ejecución:', JSON.stringify(nuevas, null, 2));
    });
}

export { fetchLicitaciones };
