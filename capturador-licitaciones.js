import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Faltan las credenciales de Supabase en las variables de entorno.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// URL del fichero ZIP oficial de la Plataforma de Contratación del Sector Público
const ZIP_URL = "https://contrataciondelestado.es/sindicacion/sindicacion64/licitacionesPerfilContratante3.zip";

async function ejecutarCaptura() {
    console.log("Iniciando descarga del archivo ZIP oficial (esto puede tardar unos segundos debido al tamaño)...");

    try {
        const response = await fetch(ZIP_URL);
        if (!response.ok) {
            throw new Error(`Error al descargar el ZIP: ${response.statusText}`);
        }

        // Convertimos la respuesta binaria a un Buffer de Node.js
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        console.log("Descarga completada. Descomprimiendo archivo ZIP...");
        const zip = new AdmZip(buffer);
        const zipEntries = zip.getEntries();

        let xmlContent = "";
        for (const entry of zipEntries) {
            if (entry.entryName.endsWith('.atom') || entry.entryName.endsWith('.xml')) {
                console.log(`Procesando fichero interno: ${entry.entryName}`);
                xmlContent = zip.readAsText(entry);
                break;
            }
        }

        if (!xmlContent) {
            console.error("No se encontró ningún archivo XML o ATOM dentro del ZIP.");
            return;
        }

        console.log("Parseando contenido XML masivo...");
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const jsonObj = parser.parse(xmlContent);

        // Obtenemos la lista de entradas (licitaciones) del feed ATOM
        const entries = jsonObj.feed?.entry || [];
        const listaEntradas = Array.isArray(entries) ? entries : [entries];

        console.log(`Se han encontrado ${listaEntradas.length} elementos en el feed. Procesando...`);

        const licitacionesParaGuardar = [];

        for (const entry of listaEntradas) {
            // Extraemos los campos principales adaptados al esquema CODICE / PLACSP
            const numExpediente = entry['cac-place-ext:ContractFolderStatus']?.['cbc:ContractFolderID'] || entry.id;
            const objeto = entry.title?.['#text'] || entry.title || 'Sin objeto especificado';
            const urlLicitacion = entry.link?.['@_href'] || '';
            
            // Filtramos o mapeamos los datos básicos
            if (numExpediente) {
                licitacionesParaGuardar.push({
                    num_expediente: String(numExpediente).trim(),
                    objeto_contrato: String(objeto).trim(),
                    estado_oficial: 'Publicada',
                    url_licitacion: String(urlLicitacion).trim()
                });
            }
        }

        if (licitacionesParaGuardar.length === 0) {
            console.log("No hay licitaciones válidas para insertar.");
            return;
        }

        // Dividimos en lotes (chunks) de 500 para evitar saturar Supabase con miles de registros
        const tamanoLote = 500;
        for (let i = 0; i < licitacionesParaGuardar.length; i += tamanoLote) {
            const lote = licitacionesParaGuardar.slice(i, i + tamanoLote);

            // Inserción inteligente en Supabase (Upsert: si ya existe el expediente, lo actualiza; si no, lo crea)
            const { error } = await supabase
                .from('licitaciones')
                .upsert(lote, { onConflict: 'num_expediente' });

            if (error) {
                console.error(`Error al guardar el lote ${i} en Supabase:`, error);
            }
        }

        console.log(`¡Proceso completado con éxito! Sincronizados ${licitacionesParaGuardar.length} registros en Supabase.`);

    } catch (err) {
        console.error("Error crítico durante la ejecución del script:", err);
        process.exit(1);
    }
}

ejecutarCaptura();
