/**
 * capturador-licitaciones.js
 * Script completo y definitivo para la captura de licitaciones de la PLACSP
 * conforme a las especificaciones técnicas de sindicación Atom.
 */

import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';

const STATE_FILE = path.resolve('./processed_ids.json');

// Endpoint oficial de sindicación Atom de la PLACSP
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
    console.log(`[${new Date().toISOString()}] Conectando con el canal Atom de la PLACSP...`);
    
    try {
        const response = await fetch(ATOM_URL, {
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/atom+xml, application/xml, text/xml, */*'
            }
        });

        if (!response.ok) {
            throw new Error(`Error en la respuesta HTTP: ${response.status} - ${response.statusText}`);
        }

        const rawText = await response.text();

        if (rawText.trim().toLowerCase().startsWith('<!doctype html') || rawText.includes('<html')) {
            throw new Error('El servidor de la PLACSP ha respondido con una página HTML (posible redirección de seguridad o bloqueo de agente).');
        }

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            removeNamespace: true
        });

        const jsonObj = parser.parse(rawText);
        const rawEntries = findEntriesRecursive(jsonObj);

        if (!rawEntries || rawEntries.length === 0) {
            console.log('Aviso: No se encontraron entradas en el feed Atom.');
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

        console.log(`Licitaciones nuevas detectadas: ${nuevasLicitaciones.length}`);
        return nuevasLicitaciones;

    } catch (error) {
        console.error('Error crítico durante la captura de licitaciones:', error.message);
        return [];
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    fetchLicitaciones().then(nuevas => {
        console.log('Resultado de la ejecución:', JSON.stringify(nuevas, null, 2));
    });
}

export { fetchLicitaciones };
