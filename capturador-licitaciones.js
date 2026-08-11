/**
 * capturador-licitaciones.js
 * Script definitivo con búsqueda tolerante de entradas para la PLACSP.
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

async function fetchLicitaciones() {
    console.log(`[${new Date().toISOString()}] Conectando con el feed de la PLACSP...`);
    
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
            attributeNamePrefix: '@_',
            removeNamespace: true
        });

        const jsonObj = parser.parse(xmlData);
        
        // Obtener el nodo raíz de forma segura
        let feed = jsonObj.feed || jsonObj.rss || jsonObj.channel;
        if (!feed) {
            const rootKey = Object.keys(jsonObj).find(k => k && k !== '?xml');
            feed = rootKey ? jsonObj[rootKey] : null;
        }

        if (!feed) {
            console.log('Aviso: No se pudo determinar el nodo raíz del feed.');
            return [];
        }

        // Búsqueda tolerante de entradas (soporta <entry>, <item> o contenedores anidados)
        let rawEntries = feed.entry || feed.item;
        if (!rawEntries) {
            const possibleKey = Object.keys(feed).find(k => {
                const val = feed[k];
                return Array.isArray(val) || (val && typeof val === 'object' && (val.entry || val.item));
            });
            if (possibleKey) {
                const container = feed[possibleKey];
                rawEntries = Array.isArray(container) ? container : (container.entry || container.item);
            }
        }

        if (!rawEntries) {
            console.log('Aviso: No se encontraron entradas de licitación. Estructura de claves raíz detectada:', Object.keys(feed));
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
