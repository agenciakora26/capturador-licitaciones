/**
 * capturador-licitaciones.js - v2.1
 * Mejorado: Mapeo real de estados, búsqueda agresiva de etiquetas UBL y filtrado de lotes.
 */

import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

const INITIAL_ATOM_URL = 'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom';

// Búsqueda profunda expandida para estándares UBL/PLACSP
function findValueDeep(obj, targetKeys) {
    if (!obj || typeof obj !== 'object') return null;
    const keys = Array.isArray(targetKeys) ? targetKeys : [targetKeys];
    
    // Normalizar teclas para comparación
    const keysLower = keys.map(k => k.toLowerCase());

    for (const key of Object.keys(obj)) {
        const lowerKey = key.toLowerCase();
        
        // Comprobar si la clave actual es una de las buscadas
        if (keysLower.some(tk => lowerKey.endsWith(':' + tk) || lowerKey === tk)) {
            const val = obj[key];
            if (val !== null && val !== undefined) {
                if (typeof val === 'string' || typeof val === 'number') return String(val).trim();
                if (val['#text']) return String(val['#text']).trim();
            }
        }
        
        // Recursividad
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
    if (obj.entry) return Array.isArray(obj.entry) ? obj.entry : [obj.entry];
    if (obj.item) return Array.isArray(obj.item) ? obj.item : [obj.item];
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
        let feed = jsonObj.feed || jsonObj.root; // Soporte para diferentes wrappers
        if (!feed) {
            const rootKey = Object.keys(jsonObj).find(k => k && k !== '?xml');
            feed = rootKey ? jsonObj[rootKey] : null;
        }
        if (!feed || !feed.link) return null;
        const links = Array.isArray(feed.link) ? feed.link : [feed.link];
        const nextLink = links.find(l => l && l['@_rel'] === 'next');
        return nextLink ? nextLink['@_href'] : null;
    } catch (e) { return null; }
}

function mapearEstadoOficial(codigoRaw) {
    if (!codigoRaw) return 'Estado no especificado';
    const val = String(codigoRaw).toUpperCase().trim();
    if (val.includes('PUB')) return 'Publicada';
    if (val.includes('EV_PREV')) return 'Evaluación Previa';
    if (val.includes('EV')) return 'Evaluación';
    if (val.includes('PLAZO')) return 'En plazo';
    if (val.includes('ADJ_PROV')) return 'Adjudicación Provisional';
    if (val.includes('ADJ')) return 'Adjudicada';
    if (val.includes('RES')) return 'Resuelta';
    if (val.includes('DES')) return 'Desistida';
    if (val.includes('ANU')) return 'Anulada';
    return val; // Devolver el código original si no coincide para poder debuguear
}

function esEstadoPasado(estadoOficial) {
    const estadosPasados = ['Adjudicada', 'Resuelta', 'Desistida', 'Anulada', 'Parcialmente Adjudicada', 'Parcialmente Resuelta'];
    return estadosPasados.includes(estadoOficial);
}

async function sincronizarLicitaciones() {
    console.log(`[${new Date().toISOString()}] Iniciando sincronización...`);
    
    let currentUrl = INITIAL_ATOM_URL;
    let pagesProcessed = 0;
    let stats = { processed: 0, skippedOldDate: 0, skippedPastStatus: 0 };

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNamespace: true });
    const headers = { 'User-Agent': 'Mozilla/5.0' };

    while (currentUrl) {
        try {
            pagesProcessed++;
            console.log(`[Página ${pagesProcessed}]`);
            
            const response = await fetch(currentUrl, { method: 'GET', headers, redirect: 'follow' });
            if (!response.ok) break;
            
            const rawText = await response.text();
            const jsonObj = parser.parse(rawText);
            const entries = findEntriesRecursive(jsonObj);

            if (entries && entries.length > 0) {
                const batchMap = new Map();

                for (const entry of entries) {
                    const urlLicitacion = getLinkHref(entry, 'alternate') || findValueDeep(entry, ['link']);
                    if (!urlLicitacion) continue;

                    // Extracción con etiquetas UBL específicas
                    const fechaPubRaw = findValueDeep(entry, ['issueDate', 'published', 'updated', 'fechaPublicacion']) || '';
                    const fechaPub = fechaPubRaw ? new Date(fechaPubRaw) : null;

                    if (fechaPub && !isNaN(fechaPub.getTime()) && fechaPub.getFullYear() < 2026) {
                        stats.skippedOldDate++;
                        continue;
                    }

                    const titulo = findValueDeep(entry, ['title', 'summary', 'contractName']);
                    const numExpediente = findValueDeep(entry, ['ContractFolderID', 'id', 'expediente']) || 'S/N';
                    
                    // Presupuesto con etiquetas estándar UBL
                    const presupuestoRaw = findValueDeep(entry, ['TotalAmount', 'TaxExclusiveAmount', 'PayableAmount', 'presupuesto']);
                    const presupuestoBase = presupuestoRaw ? parseFloat(presupuestoRaw.replace(',', '.')) : null;
                    
                    const estadoRaw = findValueDeep(entry, ['ContractFolderStatusCode', 'status', 'estadoLicitacion']);
                    const estadoOficial = mapearEstadoOficial(estadoRaw);

                    if (esEstadoPasado(estadoOficial)) {
                        stats.skippedPastStatus++;
                        continue;
                    }

                    const provincia = findValueDeep(entry, ['CitySubdivisionName', 'Province', 'provincia']);

                    batchMap.set(urlLicitacion, {
                        num_expediente: numExpediente.substring(0, 100),
                        objeto_contrato: (titulo || 'Sin objeto').substring(0, 255),
                        presupuesto_base: !isNaN(presupuestoBase) ? presupuestoBase : null,
                        estado_oficial: estadoOficial,
                        url_licitacion: urlLicitacion,
                        provincia: provincia,
                        origen: 'PLACSP',
                        created_at: new Date().toISOString()
                    });
                }

                const batch = Array.from(batchMap.values());
                if (batch.length > 0) {
                    await supabase.from('licitaciones').upsert(batch, { onConflict: 'url_licitacion' });
                    stats.processed += batch.length;
                }
            }

            const nextUrl = getNextPageUrl(jsonObj);
            if (!nextUrl || nextUrl === currentUrl) break;
            currentUrl = nextUrl;
            
        } catch (error) { console.error(`Error página ${pagesProcessed}:`, error.message); break; }
    }
    console.log(`Finalizado. Páginas: ${pagesProcessed}, Guardados: ${stats.processed}`);
}

sincronizarLicitaciones();
