import { XMLParser } from 'fast-xml-parser';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error crítico: Faltan credenciales de Supabase en las variables de entorno.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: ws }
});

const INITIAL_ATOM_URL = 'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom';

// ==========================================
// DICCIONARIOS OFICIALES PLACSP / CODICE
// ==========================================

const mapaTiposContrato = {
    '1': 'Suministros',
    '2': 'Servicios',
    '3': 'Obras',
    '7': 'Administrativo especial',
    '8': 'Privado',
    '21': 'Gestión de Servicios Públicos',
    '22': 'Concesión de Servicios',
    '31': 'Concesión de Obras Públicas',
    '32': 'Concesión de Obras',
    '40': 'Colaboración entre el sector público y sector privado',
    '50': 'Patrimonial'
};

const mapaSubtiposSuministros = {
    '1': 'Alquiler',
    '2': 'Adquisición'
};

const mapaSubtiposObras = {
    '4500': 'Construcción',
    '4510': 'Preparación de obras',
    '4511': 'Demolición de inmuebles y movimientos de tierras',
    '4512': 'Perforaciones y sondeos',
    '4520': 'Construcción general de inmuebles y obras de ingeniería',
    '4521': 'Construcción general de edificios y obras singulares',
    '4522': 'Construcción de cubiertas y estructuras de cerramiento',
    '4523': 'Construcción de autopistas, carreteras, campos de aterrizaje',
    '4524': 'Obras hidráulicas',
    '4525': 'Otras construcciones especializadas',
    '4530': 'Instalación de edificios y obras',
    '4531': 'Instalación eléctrica',
    '4532': 'Aislamiento térmico, acústico y antivibratorio',
    '4533': 'Fontanería',
    '4534': 'Otras instalaciones de edificios y obras',
    '4540': 'Acabado de edificios y obras',
    '4541': 'Revocamiento',
    '4542': 'Instalaciones de carpintería',
    '4543': 'Revestimiento de suelos y paredes',
    '4544': 'Pintura y acristalamiento',
    '4545': 'Otros acabados de edificios y obras',
    '4550': 'Alquiler de equipo de construcción o demolición con operador'
};

const mapaSubtiposServicios = {
    '1': 'Servicios de mantenimiento y reparación',
    '2': 'Servicios de transporte por vía terrestre',
    '3': 'Servicios de transporte aéreo',
    '4': 'Transporte de correo por vía terrestre y por vía aérea',
    '5': 'Servicios de telecomunicación',
    '6': 'Servicios financieros',
    '7': 'Servicios de informática y servicios conexos',
    '8': 'Servicios de investigación y desarrollo',
    '9': 'Servicios de contabilidad, auditoría y teneduría de libros',
    '10': 'Servicios de investigación de estudios y encuestas de la opinión pública',
    '11': 'Servicios de consultores de dirección y servicios conexos',
    '12': 'Servicios de arquitectura e ingeniería',
    '13': 'Servicios de publicidad',
    '14': 'Servicios de limpieza de edificios y administración de bienes raíces',
    '15': 'Servicios editoriales y de imprenta',
    '16': 'Servicios de alcantarillado y eliminación de desperdicios',
    '17': 'Servicios de hostelería y restaurante',
    '18': 'Servicios de transporte por ferrocarril',
    '19': 'Servicios de transporte fluvial y marítimo',
    '20': 'Servicios de transporte complementarios y auxiliares',
    '21': 'Servicios jurídicos',
    '22': 'Servicios de colocación y suministro de personal',
    '23': 'Servicios de investigación y seguridad',
    '24': 'Servicios de educación y formación profesional',
    '25': 'Servicios sociales y de salud',
    '26': 'Servicios de esparcimiento, culturales y deportivos',
    '27': 'Otros servicios'
};

const mapaSubtiposPatrimonial = {
    '10': 'Autorización demanial',
    '11': 'Concesión demanial',
    '20': 'Explotación de bienes inmuebles mediante arrendamiento',
    '21': 'Explotación de bienes muebles mediante arrendamiento',
    '22': 'Explotación de bienes de propiedad incorporal',
    '23': 'Cesión de uso/titularidad',
    '30': 'Adquisición de inmuebles',
    '31': 'Adquisición de derechos de propiedad incorporal',
    '40': 'Arrendamiento de inmuebles',
    '50': 'Enajenación de inmuebles',
    '51': 'Enajenación de bienes muebles',
    '52': 'Enajenación de derechos de propiedad incorporal',
    '60': 'Permuta',
    '100': 'Otros contratos patrimoniales'
};

// ==========================================
// FUNCIONES DE EXTRACCIÓN
// ==========================================

// Extractor robusto de valores en UBL / JSON parseado
function findValueDeep(obj, targetKey) {
    if (!obj || typeof obj !== 'object') return null;
    
    for (const key of Object.keys(obj)) {
        const cleanKey = key.includes(':') ? key.split(':')[1] : key;
        if (cleanKey.toLowerCase() === targetKey.toLowerCase()) {
            const val = obj[key];
            if (val !== null && val !== undefined) {
                if (typeof val === 'object') {
                    if (val['#text'] !== undefined) return String(val['#text']).trim();
                    if (val['@_value'] !== undefined) return String(val['@_value']).trim();
                    return null;
                }
                return String(val).trim();
            }
        }
        if (typeof obj[key] === 'object') {
            const found = findValueDeep(obj[key], targetKey);
            if (found !== null && found !== undefined) return found;
        }
    }
    return null;
}

// Extractor específico para obtener la fecha de fin de oferta de la estructura UBL de PLACSP
function extractFechaFin(entry) {
    try {
        const tenderingProcess = findObjectDeep(entry, 'TenderingProcess');
        if (tenderingProcess) {
            const deadlinePeriod = findObjectDeep(tenderingProcess, 'TenderSubmissionDeadlinePeriod');
            if (deadlinePeriod) {
                const endDate = findValueDeep(deadlinePeriod, 'EndDate');
                if (endDate) {
                    const endTime = findValueDeep(deadlinePeriod, 'EndTime');
                    if (endTime) {
                        return `${endDate}T${endTime}`;
                    }
                    return endDate;
                }
            }
        }
        return findValueDeep(entry, 'SubmissionDeadlineDate') || findValueDeep(entry, 'Deadline');
    } catch (e) {
        return null;
    }
}

// Extractor del Tipo de Contrato oficial
function extractTipoContrato(entry) {
    let tipo = findValueDeep(entry, 'ContractTypeCode') || 
               findValueDeep(entry, 'TypeCode') || 
               findValueDeep(entry, 'TipoContrato');
               
    if (tipo) {
        const codigoLimpio = String(tipo).trim();
        if (mapaTiposContrato[codigoLimpio]) {
            return mapaTiposContrato[codigoLimpio];
        }
        return codigoLimpio;
    }
    
    const summary = findValueDeep(entry, 'Summary') || '';
    const lowerSummary = summary.toLowerCase();
    if (lowerSummary.includes('obras')) return 'Obras';
    if (lowerSummary.includes('suministro')) return 'Suministros';
    if (lowerSummary.includes('servicios')) return 'Servicios';
    
    return null;
}

// Extractor del Subtipo de Contrato según el tipo principal
function extractSubtipo(entry, tipoContrato) {
    if (!tipoContrato) return 'General';
    
    const codigoSubtipo = findValueDeep(entry, 'SubTypeCode') || findValueDeep(entry, 'ServiceContractCode');
    const codigoLimpio = codigoSubtipo ? String(codigoSubtipo).trim() : null;

    if (!codigoLimpio) return 'General';

    switch (tipoContrato) {
        case 'Suministros':
            return mapaSubtiposSuministros[codigoLimpio] || 'General';
        case 'Obras':
            return mapaSubtiposObras[codigoLimpio] || 'General';
        case 'Servicios':
            return mapaSubtiposServicios[codigoLimpio] || 'General';
        case 'Patrimonial':
            return mapaSubtiposPatrimonial[codigoLimpio] || 'General';
        default:
            return 'General';
    }
}

// Extractor actualizado para el estado oficial real de la licitación
function extractEstadoOficial(entry) {
    const mapaEstados = {
        'CREA': 'Creada',
        'PRE': 'Anuncio Previo',
        'PUB': 'Publicada',
        'EV_PRE': 'Evaluación Previa',
        'EV': 'Evaluación',
        'ADJ': 'Adjudicada',
        'ADJ_PAR': 'Parcialmente Adjudicada',
        'PAR_RES': 'Adjudicación Provisional',
        'RES': 'Resuelta',
        'RES_PAR': 'Parcialmente Resuelta',
        'DES': 'Desistida',
        'CERR': 'Cerrada',
        'ANUL': 'Anulada'
    };

    const codigo = findValueDeep(entry, 'ContractFolderStatusCode');
    if (codigo && mapaEstados[codigo.trim()]) {
        return mapaEstados[codigo.trim()];
    }

    const summary = (findValueDeep(entry, 'Summary') || '').toUpperCase();
    if (summary.includes('ESTADO: RES_PAR')) return 'Parcialmente Resuelta';
    if (summary.includes('ESTADO: PAR_RES')) return 'Adjudicación Provisional';
    if (summary.includes('ESTADO: ADJ_PAR')) return 'Parcialmente Adjudicada';
    if (summary.includes('ESTADO: EV_PRE')) return 'Evaluación Previa';
    if (summary.includes('ESTADO: CREA')) return 'Creada';
    if (summary.includes('ESTADO: PRE')) return 'Anuncio Previo';
    if (summary.includes('ESTADO: PUB')) return 'Publicada';
    if (summary.includes('ESTADO: EV')) return 'Evaluación';
    if (summary.includes('ESTADO: ADJ')) return 'Adjudicada';
    if (summary.includes('ESTADO: RES')) return 'Resuelta';
    if (summary.includes('ESTADO: DES')) return 'Desistida';
    if (summary.includes('ESTADO: CERR')) return 'Cerrada';
    if (summary.includes('ESTADO: ANUL')) return 'Anulada';

    return 'Consultar Pliego';
}

function extractLinkUrl(entry) {
    if (!entry) return null;
    let linkField = entry.link;
    if (!linkField && entry.entry) linkField = entry.entry.link;
    if (!linkField) linkField = findObjectDeep(entry, 'link');
    if (!linkField) return null;
    
    const links = Array.isArray(linkField) ? linkField : [linkField];
    const targetLink = links.find(l => l && (l['@_rel'] === 'alternate' || !l['@_rel'])) || links[0];
    
    if (targetLink) {
        if (typeof targetLink === 'string') return targetLink.trim();
        return targetLink['@_href'] || targetLink['href'] || null;
    }
    return null;
}

function findObjectDeep(obj, targetKey) {
    if (!obj || typeof obj !== 'object') return null;
    for (const key of Object.keys(obj)) {
        const cleanKey = key.includes(':') ? key.split(':')[1] : key;
        if (cleanKey.toLowerCase() === targetKey.toLowerCase()) return obj[key];
        if (typeof obj[key] === 'object') {
            const found = findObjectDeep(obj[key], targetKey);
            if (found) return found;
        }
    }
    return null;
}

function findEntriesRecursive(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.entry) return Array.isArray(obj.entry) ? obj.entry : [obj.entry];
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
        return nextLink ? (nextLink['@_href'] || nextLink['href']) : null;
    } catch (e) { return null; }
}

async function sincronizarLicitaciones() {
    console.log(`[${new Date().toISOString()}] Iniciando captura completa (tipos, subtipos, estados y plazos)...`);
    
    let currentUrl = INITIAL_ATOM_URL;
    let pageCount = 0;
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNamespace: true });
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

    while (currentUrl) {
        pageCount++;
        console.log(`\n--- Procesando Página ${pageCount} ---`);
        console.log(`URL: ${currentUrl}`);

        try {
            const response = await fetch(currentUrl, { headers, redirect: 'follow' });
            if (!response.ok) {
                console.error(`Error HTTP ${response.status} al descargar la página.`);
                break;
            }

            const rawText = await response.text();
            const jsonObj = parser.parse(rawText);
            const entries = findEntriesRecursive(jsonObj);
            
            if (!entries || entries.length === 0) {
                console.log('No se encontraron entradas en esta página.');
                break;
            }

            const batchMap = new Map();
            let skippedOld = 0;
            let skippedNoUrl = 0;

            for (const entry of entries) {
                const pubDateRaw = findValueDeep(entry, 'Published') || findValueDeep(entry, 'IssueDate') || findValueDeep(entry, 'updated');
                const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
                
                // Filtro estricto 2026 en adelante
                if (!pubDate || isNaN(pubDate.getTime()) || pubDate.getFullYear() < 2026) {
                    skippedOld++;
                    continue;
                }

                const url = extractLinkUrl(entry);
                if (!url) {
                    skippedNoUrl++;
                    continue;
                }

                const rawTitle = findValueDeep(entry, 'Title') || '';
                const objetoContrato = rawTitle.replace(/Id licitación: [^;]+; /i, '').substring(0, 500);
                
                const numExpediente = findValueDeep(entry, 'ContractFolderID') || findValueDeep(entry, 'ID') || 'S/N';
                const tipoContrato = extractTipoContrato(entry);
                const subtipoContrato = extractSubtipo(entry, tipoContrato);
                const estadoOficial = extractEstadoOficial(entry);
                const cpv = findValueDeep(entry, 'ItemClassificationCode');
                
                const fechaFinRaw = extractFechaFin(entry);
                const fechaFinISO = fechaFinRaw && !isNaN(new Date(fechaFinRaw).getTime()) ? new Date(fechaFinRaw).toISOString() : null;

                const provincia = findValueDeep(entry, 'CitySubdivisionName') || findValueDeep(entry, 'Province') || findValueDeep(entry, 'CountrySubentity');
                
                const presupuestoRaw = findValueDeep(entry, 'TotalAmount') || findValueDeep(entry, 'TaxExclusiveAmount');
                const presupuesto = presupuestoRaw ? parseFloat(presupuestoRaw.replace(',', '.')) : null;

                batchMap.set(url, {
                    num_expediente: numExpediente.substring(0, 255),
                    objeto_contrato: objetoContrato || 'Sin objeto',
                    presupuesto_base: !isNaN(presupuesto) ? presupuesto : null,
                    tipo_contrato: tipoContrato ? tipoContrato.substring(0, 100) : null,
                    subtipo_contrato: subtipoContrato ? subtipoContrato.substring(0, 100) : 'General',
                    codigo_cpv: cpv ? cpv.substring(0, 50) : null,
                    estado_oficial: estadoOficial ? estadoOficial.substring(0, 100) : 'Publicada',
                    fecha_fin_oferta: fechaFinISO,
                    provincia: provincia ? provincia.substring(0, 100) : null,
                    url_licitacion: url,
                    origen: 'PLACSP',
                    created_at: new Date().toISOString()
                });
            }

            const batch = Array.from(batchMap.values());
            console.log(`Filtro -> Omitidos (<2026): ${skippedOld} | Sin URL: ${skippedNoUrl} | Válidos para upsert: ${batch.length}`);

            if (batch.length > 0) {
                console.log('Enviando lote a Supabase (actualizando tipos, subtipos, estados y plazos)...');
                const { error: upsertError } = await supabase
                    .from('licitaciones')
                    .upsert(batch, { onConflict: 'url_licitacion' });

                if (upsertError) {
                    console.error('Error al insertar en Supabase:', upsertError.message);
                } else {
                    console.log(`¡Lote de ${batch.length} licitaciones sincronizado con éxito!`);
                }
            }

            currentUrl = getNextPageUrl(jsonObj);
            if (!currentUrl) {
                console.log('No hay más páginas siguientes. Sincronización completada.');
                break;
            }

        } catch (error) {
            console.error('Excepción en ciclo:', error);
            break;
        }
    }
}

export { sincronizarLicitaciones as ejecutarCapturadorLicitaciones };
