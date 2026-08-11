/**
 * capturador-licitaciones.js
 * Script definitivo con búsqueda recursiva de entradas y cabeceras robustas para la PLACSP.
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

function getSubValue(obj, fieldName) {
    if (!obj || typeof obj !== 'object') return '';
    const val = obj[fieldName];
    if (!val) return '';
    if (typeof val === 'string' || typeof val === 'number') return String(val);
    if (val['#text']) return String(val['#text']);
    return '';
}

function getLinkHref(entry) {
    if (!entry || !entry.link) return '';
    const links = Array.isArray(entry.link) ? entry.link : [entry.link];
    const preferred = links.find(l => l && (l['@_rel'] === 'alternate' || !l['@_rel']));
    return preferred ? (preferred['@_href'] || '') : (links[0]['@_href'] || '');
}

/**
 * Busca de forma recursiva cualquier propiedad 'entry' o 'item' dentro del objeto JSON parseado.
 */
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

async function fetchLicitaciones() {
    console.log(`[${new Date().toISOString()}] Conectando con el feed Atom de la PLACSP...`);
    
    try {
        const response = await fetch(ATOM_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/atom+xml, application/xml, text/xml, */*',
                'Accept-Language': 'es-ES,es;q=0.9'
            }
        });

        if (!response.ok) {
            throw new Error(`Error en la respuesta HTTP: ${response.status} - ${response.statusText}`);
        }

        const xmlData = await response.text();

        // Verificar si por error se recibió HTML
        if (xmlData.trim().toLowerCase().startsWith('<!doctype html') || xmlData.includes('<html')) {
            console.error('Error: El servidor devolvió una página HTML en lugar de un feed Atom (posible bloqueo o URL incorrecta).');
            return [];
        }

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            removeNamespace: true
        });

        const jsonObj = parser.parse(xmlData);
        
        // Búsqueda recursiva tolerante de entradas Atom
        const rawEntries = findEntriesRecursive(jsonObj);

        if (!rawEntries || rawEntries.length === 0) {
            console.log('Aviso: No se encontraron entradas de licitación en el documento.');
            return [];
        }

        const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
        console.log(`Total de registros leídos en el feed actual: ${entries.length}`);

        const processedIds = loadProcessedIds();
        const nuevasLicitaciones = [];

        for (const entry of entries) {
            const entryId = getSubValue(entry, 'id') || getSubValue(entry, 'guid') || getLinkHref(entry);

            if (entryId && !processedIds.has(entryId)) {
                const licitacion = {
                    id: entryId,
                    title: getSubValue(entry, 'title'),
                    updated: getSubValue(entry, 'updated') || getSubValue(entry, 'pubDate') || getSubValue(entry, 'published') || new Date().toISOString(),
                    link: getLinkHref(entry) || getSubValue(entry, 'link'),
                    summary: getSubValue(entry, 'summary') || getSubValue(entry, 'description')
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
