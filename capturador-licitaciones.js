/**
 * capturador-licitaciones.js
 * Script completo para la captura y filtrado diario de licitaciones de la PLACSP,
 * evitando duplicidades mediante control de estado persistente.
 */

import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';

// Archivo local para almacenar los IDs ya procesados y evitar reintentos estáticos
const STATE_FILE = path.resolve('./processed_ids.json');

// URL oficial del feed Atom de la PLACSP (sindicación general actualizada)
const ATOM_URL = 'https://contrataciondelestado.es/sindicacion/sindicacion64?tipoLicitacion=1';

/**
 * Carga los IDs previamente procesados desde el disco.
 * @returns {Set<string>} Conjunto de IDs únicos.
 */
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

/**
 * Guarda el conjunto actualizado de IDs procesados en el disco.
 * @param {Set<string>} processedSet 
 */
function saveProcessedIds(processedSet) {
    try {
        const arrayData = Array.from(processedSet);
        fs.writeFileSync(STATE_FILE, JSON.stringify(arrayData, null, 2), 'utf-8');
    } catch (error) {
        console.error('Error al guardar el archivo de estado de IDs:', error.message);
    }
}

/**
 * Realiza la petición HTTP al feed Atom, parsea el XML y filtra las licitaciones nuevas.
 * @returns {Promise<Array>} Lista de nuevas licitaciones detectadas.
 */
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

        // Configuración del parser XML optimizada para feeds Atom/CODICE
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_'
        });

        const jsonObj = parser.parse(xmlData);
        
        // Identificar el elemento raíz del feed Atom
        const feed = jsonObj.feed || jsonObj['atom:feed'];
        if (!feed || !feed.entry) {
            console.log('Aviso: No se encontraron entradas en el feed Atom en esta ejecución.');
            return [];
        }

        // Asegurar que 'entry' sea siempre un array independientemente de la cantidad de elementos
        const entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];
        console.log(`Total de registros leídos en el feed actual: ${entries.length}`);

        const processedIds = loadProcessedIds();
        const nuevasLicitaciones = [];

        for (const entry of entries) {
            // Extracción de un identificador único robusto (ID de Atom o enlace principal)
            const entryId = entry.id || (entry.link && entry.link['@_href']) || null;

            if (entryId && !processedIds.has(entryId)) {
                const licitacion = {
                    id: entryId,
                    title: typeof entry.title === 'object' ? (entry.title['#text'] || JSON.stringify(entry.title)) : entry.title,
                    updated: entry.updated || entry.published || new Date().toISOString(),
                    link: entry.link && entry.link['@_href'] ? entry.link['@_href'] : (typeof entry.link === 'string' ? entry.link : ''),
                    summary: typeof entry.summary === 'object' ? (entry.summary['#text'] || '') : (entry.summary || '')
                };

                nuevasLicitaciones.push(licitacion);
                processedIds.add(entryId);
            }
        }

        // Persistir el estado actualizado para futuras ejecuciones diarias
        saveProcessedIds(processedIds);

        console.log(`Licitaciones nuevas reales detectadas tras filtrar el histórico: ${nuevasLicitaciones.length}`);
        return nuevasLicitaciones;

    } catch (error) {
        console.error('Error crítico durante la captura de licitaciones:', error.message);
        return [];
    }
}

// Ejecución directa por consola
if (import.meta.url === `file://${process.argv[1]}`) {
    fetchLicitaciones().then(nuevas => {
        if (nuevas.length > 0) {
            console.log('Detalle de las licitaciones capturadas:', JSON.stringify(nuevas, null, 2));
        } else {
            console.log('Sin novedades: todos los registros del feed ya habían sido procesados previamente.');
        }
    });
}

export { fetchLicitaciones };
