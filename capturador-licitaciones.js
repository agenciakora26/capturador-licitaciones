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

const mapaTiposProcedimiento = {
    '1': 'Abierto',
    '9': 'Abierto simplificado',
    '10': 'Asociación para la innovación',
    '7': 'Basado en Acuerdo Marco',
    '12': 'Basado en sistema dinámico de adquisición',
    '8': 'Concurso de proyectos',
    '11': 'Derivado de asociación para la innovación',
    '5': 'Diálogo competitivo',
    '13': 'Licitación con negociación',
    '4': 'Negociado con publicidad',
    '3': 'Negociado sin publicidad',
    '100': 'Normas Internas',
    '999': 'Otros',
    '2': 'Restringido'
};

const mapaTiposAnuncio = {
    'LICI_PLA': 'Licitaciones en plazo',
    'DOC_PIN': 'Anuncio Previo',
    'DOC_PIN_RTL': 'Anuncio de información previa con reducción de plazos',
    'DOC_CN': 'Anuncio de Licitación',
    'DOC_CD': 'Pliego/Documento Descriptivo',
    'DOC_CAN_PROV': 'Anuncio Adjudicación Provisional',
    'DOC_CAN_DEF': 'Anuncio Adjudicación Definitiva',
    'DOC_CAN_ADJ': 'Anuncio Adjudicación',
    'DOC_FORM': 'Anuncio de Formalización',
    'DOC_MOD': 'Anuncio Modificación de Contrato',
    'DOC_CCN': 'Anuncio de finalización de contrato',
    'DESIERTO': 'Desierto',
    'RENUNCIA': 'Renuncia',
    'DESISTIMIENTO': 'Desistimiento'
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
// MAPA NUTS OFICIAL Y FUNCIONES DE EXTRACCIÓN
// ==========================================

const MAPA_TEXTO_A_NUTS = {
    "españa": "ES", "espaã±a": "ES", "espana": "ES",
    "noroeste": "ES1", "galicia": "ES11", "a coruña": "ES111",
    "lugo": "ES112", "ourense": "ES113", "pontevedra": "ES114", "principado de asturias": "ES12",
    "asturias": "ES120", "cantabria": "ES130", "noreste": "ES2", "país vasco": "ES21",
    "araba/álava": "ES211", "álava": "ES211", "gipuzkoa": "ES212", "bizkaia": "ES213",
    "comunidad foral de navarra": "ES22", "navarra": "ES220", "la rioja": "ES230",
    "aragón": "ES24", "huesca": "ES241", "teruel": "ES242", "zaragoza": "ES243",
    "comunidad de madrid": "ES3", "madrid": "ES300", "centro (es)": "ES4",
    "castilla y león": "ES41", "ávila": "ES411", "burgos": "ES412", "león": "ES413",
    "palencia": "ES414", "salamanca": "ES415", "segovia": "ES416", "soria": "ES417",
    "valladolid": "ES418", "zamora": "ES419", "castilla-la mancha": "ES42",
    "albacete": "ES421", "ciudad real": "ES422", "cuenca": "ES423", "guadalajara": "ES424",
    "toledo": "ES425", "extremadura": "ES43", "badajoz": "ES431", "cáceres": "ES432",
    "este": "ES5", "cataluña": "ES51", "barcelona": "ES511", "girona": "ES512",
    "lleida": "ES513", "tarragona": "ES514", "comunitat valenciana": "ES52",
    "alicante/alacant": "ES521", "alicante": "ES521", "castellón/castelló": "ES522",
    "castellón": "ES522", "valencia/valència": "ES523", "valencia": "ES523",
    "illes balears": "ES53", "baleares": "ES53", "eivissa y formentera": "ES531",
    "mallorca": "ES532", "menorca": "ES533", "sur": "ES6", "andalucía": "ES61",
    "almería": "ES611", "cádiz": "ES612", "córdoba": "ES613", "granada": "ES614",
    "huelva": "ES615", "jaén": "ES616", "málaga": "ES617", "sevilla": "ES618",
    "región de murcia": "ES62", "murcia": "ES620", "ciudades autónomas": "ES63",
    "ceuta": "ES630", "melilla": "ES640", "canarias": "ES70", "gran canaria": "ES705",
    "tenerife": "ES709", "extra-regio nuts 1": "ESZ", "extra-regio nuts 2": "ESZZ", "extra-regio nuts 3": "ESZZZ"
};
const MAPA_NUTS_A_TEXTO = Object.fromEntries(
    Object.entries(MAPA_TEXTO_A_NUTS).map(([texto, nuts]) => [nuts, texto])
);
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

function extractProvincia(entry) {
    // 1. PRIORIDAD MÁXIMA: Buscar si el XML trae un código NUTS directo oficial
    const nutsDirecto = findValueDeep(entry, 'NutsCode') || findValueDeep(entry, 'CountrySubentityCode') || findValueDeep(entry, 'NUTS');
    if (nutsDirecto) {
        const nutsLimpio = String(nutsDirecto).toUpperCase().trim();
        if (nutsLimpio.startsWith('ES')) {
            const nombreProvincia = MAPA_NUTS_A_TEXTO[nutsLimpio] || null;
            return {
                codigo_nuts: nutsLimpio,
                provincia: nombreProvincia ? nombreProvincia.charAt(0).toUpperCase() + nombreProvincia.slice(1) : null
            };
        }
    }

    // 2. SEGUNDA OPCIÓN: Bloques de localización extendidos
    const locationBlocks = ['RealizedLocation', 'DeliveryLocation', 'JurisdictionRegionCode', 'Address', 'Location', 'CountrySubentity'];
    for (const blockName of locationBlocks) {
        const block = findObjectDeep(entry, blockName);
        if (block) {
            const subentity = findValueDeep(block, 'CountrySubentity') || findValueDeep(block, 'Province') || findValueDeep(block, 'Code') || findValueDeep(block, 'CityName');
            if (subentity) {
                const limpia = subentity.toLowerCase().trim();
                if (MAPA_TEXTO_A_NUTS[limpia]) {
                    return {
                        codigo_nuts: MAPA_TEXTO_A_NUTS[limpia],
                        provincia: subentity
                    };
                }
            }
        }
    }

    // 3. PLAN B: Búsqueda estricta por expresiones regulares en texto completo
    const partyName = findValueDeep(entry, 'PartyName') || findValueDeep(entry, 'Name') || findValueDeep(entry, 'ContractingParty') || '';
    const summary = findValueDeep(entry, 'Summary') || '';
    const title = findValueDeep(entry, 'Title') || '';
    const textoCompleto = `${partyName} ${title} ${summary}`.toLowerCase();

    for (const [key, code] of Object.entries(MAPA_TEXTO_A_NUTS)) {
        const regex = new RegExp(`\\b${key}\\b`, 'i');
        if (regex.test(textoCompleto)) {
            return {
                codigo_nuts: code,
                provincia: key.charAt(0).toUpperCase() + key.slice(1)
            };
        }
    }

    // --- CHIVATO DE DEPURACIÓN TEMPORAL ---
    // Si llega aquí y todo es null, imprimimos un resumen del objeto que falló en la consola
    // para descubrir qué etiquetas usa este formato en particular.
    if (Math.random() < 0.05) { // Muestra aleatoria del 5% para no saturar la consola
        console.log("🔍 [DEBUG NUTS NULL] Expediente sin NUTS detectado. Título:", title.substring(0, 80));
    }

    return {
        codigo_nuts: null,
        provincia: null
    };
}
function extractTipoProcedimiento(entry) {
    let codigo = findValueDeep(entry, 'ProcedureCode');
    if (codigo) {
        const codigoLimpio = String(codigo).trim();
        return mapaTiposProcedimiento[codigoLimpio] || codigoLimpio;
    }
    return 'General';
}

function extractTipoAnuncio(entry) {
    let codigo = findValueDeep(entry, 'NoticeTypeCode') || findValueDeep(entry, 'DocumentTypeCode') || findValueDeep(entry, 'TypeCode');
    
    if (!codigo && entry.category) {
        const cats = Array.isArray(entry.category) ? entry.category : [entry.category];
        for (const cat of cats) {
            const term = cat['@_term'] || cat.term;
            if (term && mapaTiposAnuncio[term.trim()]) {
                codigo = term.trim();
                break;
            }
        }
    }

    if (codigo) {
        const codigoLimpio = String(codigo).trim();
        return mapaTiposAnuncio[codigoLimpio] || codigoLimpio;
    }
    return 'Anuncio de Licitación';
}

function extractFechaFin(entry) {
    try {
        const tenderingProcess = findObjectDeep(entry, 'TenderingProcess');
        if (tenderingProcess) {
            const deadlinePeriod = findObjectDeep(tenderingProcess, 'TenderSubmissionDeadlinePeriod');
            if (deadlinePeriod) {
                const endDate = findValueDeep(deadlinePeriod, 'EndDate');
                if (endDate) {
                    const endTime = findValueDeep(deadlinePeriod, 'EndTime');
                    return endTime ? `${endDate}T${endTime}` : endDate;
                }
            }
        }
        return findValueDeep(entry, 'SubmissionDeadlineDate') || findValueDeep(entry, 'Deadline');
    } catch (e) { return null; }
}

function extractTipoContrato(entry) {
    let tipo = findValueDeep(entry, 'ContractTypeCode') || findValueDeep(entry, 'TypeCode') || findValueDeep(entry, 'TipoContrato');
    if (tipo) {
        const codigoLimpio = String(tipo).trim();
        return mapaTiposContrato[codigoLimpio] || codigoLimpio;
    }
    const summary = (findValueDeep(entry, 'Summary') || '').toLowerCase();
    if (summary.includes('obras')) return 'Obras';
    if (summary.includes('suministro')) return 'Suministros';
    if (summary.includes('servicios')) return 'Servicios';
    return null;
}

function extractSubtipo(entry, tipoContrato) {
    if (!tipoContrato) return 'General';
    const codigoSubtipo = findValueDeep(entry, 'SubTypeCode') || findValueDeep(entry, 'ServiceContractCode');
    const codigoLimpio = codigoSubtipo ? String(codigoSubtipo).trim() : null;
    if (!codigoLimpio) return 'General';
    switch (tipoContrato) {
        case 'Suministros': return mapaSubtiposSuministros[codigoLimpio] || 'General';
        case 'Obras': return mapaSubtiposObras[codigoLimpio] || 'General';
        case 'Servicios': return mapaSubtiposServicios[codigoLimpio] || 'General';
        case 'Patrimonial': return mapaSubtiposPatrimonial[codigoLimpio] || 'General';
        default: return 'General';
    }
}

function extractEstadoOficial(entry) {
    const mapaEstados = { 'CREA': 'Creada', 'PRE': 'Anuncio Previo', 'PUB': 'Publicada', 'EV_PRE': 'Evaluación Previa', 'EV': 'Evaluación', 'ADJ': 'Adjudicada', 'ADJ_PAR': 'Parcialmente Adjudicada', 'PAR_RES': 'Adjudicación Provisional', 'RES': 'Resuelta', 'RES_PAR': 'Parcialmente Resuelta', 'DES': 'Desistida', 'CERR': 'Cerrada', 'ANUL': 'Anulada' };
    const codigo = findValueDeep(entry, 'ContractFolderStatusCode');
    if (codigo && mapaEstados[codigo.trim()]) return mapaEstados[codigo.trim()];
    const summary = (findValueDeep(entry, 'Summary') || '').toUpperCase();
    if (summary.includes('ESTADO: RES_PAR')) return 'Parcialmente Resuelta';
    if (summary.includes('ESTADO: PAR_RES')) return 'Adjudicación Provisional';
    if (summary.includes('ESTADO: ADJ_PAR')) return 'Parcialmente Adjudicada';
    if (summary.includes('ESTADO: EV_PRE')) return 'Evaluación Previa';
    if (summary.includes('ESTADO: PUB')) return 'Publicada';
    if (summary.includes('ESTADO: ADJ')) return 'Adjudicada';
    if (summary.includes('ESTADO: RES')) return 'Resuelta';
    if (summary.includes('ESTADO: DES')) return 'Desistida';
    return 'Consultar Pliego';
}

function extractLinkUrl(entry) {
    if (!entry) return null;
    let linkField = entry.link || (entry.entry ? entry.entry.link : null) || findObjectDeep(entry, 'link');
    if (!linkField) return null;
    const links = Array.isArray(linkField) ? linkField : [linkField];
    const targetLink = links.find(l => l && (l['@_rel'] === 'alternate' || !l['@_rel'])) || links[0];
    return typeof targetLink === 'string' ? targetLink.trim() : (targetLink['@_href'] || targetLink['href'] || null);
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
    console.log(`[${new Date().toISOString()}] Iniciando sincronización diaria optimizada con códigos NUTS...`);
    let currentUrl = INITIAL_ATOM_URL;
    let pageCount = 0;
    const MAX_PAGES = 3;
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNamespace: true });
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

    while (currentUrl && pageCount < MAX_PAGES) {
        pageCount++;
        console.log(`\n--- Procesando Página ${pageCount} de ${MAX_PAGES} ---`);
        try {
            const response = await fetch(currentUrl, { headers, redirect: 'follow' });
            if (!response.ok) break;

            const rawText = await response.text();
            const jsonObj = parser.parse(rawText);
            const entries = findEntriesRecursive(jsonObj);
            
            if (!entries || entries.length === 0) break;

            const batchMap = new Map();
            for (const entry of entries) {
                const pubDateRaw = findValueDeep(entry, 'Published') || findValueDeep(entry, 'IssueDate') || findValueDeep(entry, 'updated');
                const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
                
                if (!pubDate || isNaN(pubDate.getTime()) || pubDate.getFullYear() < 2026) continue;

                const url = extractLinkUrl(entry);
                if (!url) continue;

                const rawTitle = findValueDeep(entry, 'Title') || '';
                const objetoContrato = rawTitle.replace(/Id licitación: [^;]+; /i, '').substring(0, 500);
                
                const numExpediente = findValueDeep(entry, 'ContractFolderID') || findValueDeep(entry, 'ID') || 'S/N';
                const tipoContrato = extractTipoContrato(entry);
                const subtipoContrato = extractSubtipo(entry, tipoContrato);
                const tipoProcedimiento = extractTipoProcedimiento(entry);
                const tipoAnuncio = extractTipoAnuncio(entry);
                const estadoOficial = extractEstadoOficial(entry);
                const cpv = findValueDeep(entry, 'ItemClassificationCode');
                const fechaFinRaw = extractFechaFin(entry);
                const fechaFinISO = fechaFinRaw && !isNaN(new Date(fechaFinRaw).getTime()) ? new Date(fechaFinRaw).toISOString() : null;
                
                // 1. Obtenemos el objeto con { codigo_nuts, provincia }
                const ubicacion = extractProvincia(entry);
                
                const presupuestoRaw = findValueDeep(entry, 'TotalAmount') || findValueDeep(entry, 'TaxExclusiveAmount');
                const presupuesto = presupuestoRaw ? parseFloat(presupuestoRaw.replace(',', '.')) : null;

                batchMap.set(url, {
                    num_expediente: numExpediente.substring(0, 255),
                    objeto_contrato: objetoContrato || 'Sin objeto',
                    presupuesto_base: !isNaN(presupuesto) ? presupuesto : null,
                    tipo_contrato: tipoContrato ? tipoContrato.substring(0, 100) : null,
                    subtipo_contrato: subtipoContrato ? subtipoContrato.substring(0, 100) : 'General',
                    tipo_procedimiento: tipoProcedimiento ? tipoProcedimiento.substring(0, 100) : 'General',
                    tipo_anuncio: tipoAnuncio ? tipoAnuncio.substring(0, 100) : 'Anuncio de Licitación',
                    codigo_cpv: cpv ? cpv.substring(0, 50) : null,
                    estado_oficial: estadoOficial ? estadoOficial.substring(0, 100) : 'Publicada',
                    fecha_fin_oferta: fechaFinISO,
                    // 2. Añadimos el código NUTS oficial y la provincia limpia
                    codigo_nuts: ubicacion.codigo_nuts ? ubicacion.codigo_nuts.substring(0, 10) : 'ES',
                    provincia: ubicacion.provincia ? ubicacion.provincia.substring(0, 100) : 'España',
                    url_licitacion: url,
                    origen: 'PLACSP',
                    created_at: new Date().toISOString()
                });
            }

            if (batchMap.size > 0) {
                const { error } = await supabase.from('licitaciones').upsert(Array.from(batchMap.values()), { onConflict: 'url_licitacion' });
                if (error) console.error('Error Supabase:', error.message);
                else console.log(`Sincronizado lote de ${batchMap.size} licitaciones con NUTS y provincia inteligente.`);
            }

            if (pageCount >= MAX_PAGES) {
                console.log('Límite de páginas diarias alcanzado. Finalizando sincronización.');
                break;
            }

            currentUrl = getNextPageUrl(jsonObj);
        } catch (error) {
            console.error('Error en ciclo:', error);
            break;
        }
    }
}

export { sincronizarLicitaciones as ejecutarCapturadorLicitaciones };
