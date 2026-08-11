/**
 * capturador-licitaciones.js
 * Script adaptado para tolerar prefijos de namespaces en XML y evitar duplicidades.
 */

import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.resolve('./processed_ids.json');
const ATOM_URL = 'https://contrataciondelestado.es/sindicacion/sindicacion64?tipoLicitacion=1';

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

/**
 * Busca recursivamente o por sufijo una etiqueta ignorando prefijos de namespaces (ej. atom:feed -> feed)
 */
function findNodeBySuffix(obj, suffix) {
    if (!obj || typeof obj !== 'object') return null;
    const key = Object.keys(obj).find(k => k === suffix || k.endsWith(':' + suffix));
    return key ? obj[key] : null;
}

function getSubValue(obj, fieldName) {
    const val = findNodeBySuffix(obj, fieldName);
    if (!val) return '';
    if (typeof val === 'string' || typeof val === 'number') return String(val);
    if (val['#text']) return String(val['#text']);
    return '';
}

function getLinkHref(entry) {
    const linkNode = findNodeBySuffix(entry, 'link');
    if (!linkNode) return '';
    if (Array.isArray(linkNode)) {
        const preferred = linkNode.find(l => l['@_rel'] === 'alternate' || !l['@_rel']);
        return preferred ? (preferred['@_href'] || '') : (linkNode[0]['@_href'] || '');
    }
    if (typeof linkNode === 'object') {
        return linkNode['@_href'] || '';
    }
    return '';
}

async function fetchLicitaciones() {
    console.log(`[${new Date().toISOString()}] Conectando con el feed Atom de la PLACSP...`);
    
    try {
        const response = await fetch(ATOM_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BotLicitaciones/2.0',
                'Accept': 'application/atom+xml, application/xml, text/xml'
            }
        });

        if (!response.ok) {
            throw new Error(`Error en la respuesta HTTP: ${response.status} - ${response.statusText}`);
        }

        const xmlData = await response.text();

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });

        const jsonObj = parser.parse(xmlData);
        
        // Localizar el feed independientemente del prefijo XML
        const feed = findNodeBySuffix(jsonObj, 'feed');
        if (!feed) {
            console.log('Aviso: No se encontró el nodo raíz del feed en la respuesta.');
            return [];
        }

        // Localizar las entradas independientemente del prefijo XML
        const rawEntries = findNodeBySuffix(feed, 'entry');
        if (!rawEntries) {
            console.log('Aviso: No se encontraron entradas de licitación en el feed.');
            return [];
        }

        const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
        console.log(`Total de registros leídos en el feed actual: ${entries.length}`);

        const processedIds = loadProcessedIds();
        const nuevasLicitaciones = [];

        for (const entry of entries) {
            const entryId = getSubValue(entry, 'id') || getLinkHref(entry);

            if (entryId && !processedIds.has(entryId)) {
                const licitacion = {
                    id: entryId,
                    title: getSubValue(entry, 'title'),
                    updated: getSubValue(entry, 'updated') || getSubValue(entry, 'published') || new Date().toISOString(),
                    link: getLinkHref(entry),
                    summary: getSubValue(entry, 'summary')
                };

                nuevasLicitaciones.push(licitacion);
                processedIds.add(entryId);
            }
        }

        saveProcessedIds(processedIds);

        console.log(`Licitaciones nuevas reales detectadas: ${nuevasLicitaciones.length}`);
        return nuevasLicitaciones;

    } catch (error) {
        console.error('Error crítico durante la captura de licitaciones:', error.message);
        return [];
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    fetchLicitaciones().then(nuevas => {
        console.log('Detalle del resultado:', JSON.stringify(nuevas, null, 2));
    });
}

export { fetchLicitaciones };
