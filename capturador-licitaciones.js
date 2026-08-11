/**
 * capturador-licitaciones.js
 * Script definitivo con limpieza automática de namespaces para PLACSP.
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
    const preferred = links.find(l => l['@_rel'] === 'alternate' || !l['@_rel']);
    return preferred ? (preferred['@_href'] || '') : (links[0]['@_href'] || '');
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

        // removeNamespace: true elimina cualquier prefijo XML (ej. atom:, ns2:) automáticamente
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            removeNamespace: true
        });

        const jsonObj = parser.parse(xmlData);
        
        // Obtener el nodo raíz (feed) de forma segura
        let feed = jsonObj.feed;
        if (!feed) {
            const rootKey = Object.keys(jsonObj).find(k => k !== '?xml');
            feed = rootKey ? jsonObj[rootKey] : null;
        }

        if (!feed) {
            console.log('Aviso: No se pudo determinar el nodo raíz del feed.');
            return [];
        }

        const rawEntries = feed.entry;
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
