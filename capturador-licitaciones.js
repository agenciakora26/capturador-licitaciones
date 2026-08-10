import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Faltan las credenciales de Supabase en las variables de entorno.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// URL del feed ATOM oficial de la Plataforma de Contratación del Sector Público
const ATOM_URL = "https://contrataciondelestado.es/sindicacion/sindicacion64/licitacionesPerfilContratante3.atom";

async function ejecutarCaptura() {
    console.log("Iniciando descarga del archivo ATOM oficial...");

    try {
        const response = await fetch(ATOM_URL);
        if (!response.ok) {
            throw new Error(`Error al descargar el feed: ${response.statusText}`);
        }

        const xmlData = await response.text();
        
        // Parseamos el XML a JSON utilizando fast-xml-parser
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const jsonObj = parser.parse(xmlData);

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

        // Inserción inteligente en Supabase (Upsert: si ya existe el expediente, lo actualiza; si no, lo crea)
        const { data, error } = await supabase
            .from('licitaciones')
            .upsert(licitacionesParaGuardar, { onConflict: 'num_expediente' });

        if (error) {
            console.error("Error al guardar en Supabase:", error);
            process.exit(1);
        }

        console.log(`¡Proceso completado con éxito! Sincronizados ${licitacionesParaGuardar.length} registros en Supabase.`);

    } catch (err) {
        console.error("Error crítico durante la ejecución del script:", err);
        process.exit(1);
    }
}

ejecutarCaptura();
