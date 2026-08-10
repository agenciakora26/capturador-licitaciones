import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';
import ws from 'ws';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Faltan las credenciales de Supabase en las variables de entorno.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: { transport: ws }
});

const ZIP_URL = "https://contrataciondelestado.es/sindicacion/sindicacion64/licitacionesPerfilContratante3.zip";

async function ejecutarCaptura() {
    // ... dentro de la función ejecutarCaptura ...

        console.log("Iniciando descarga del archivo ZIP oficial con cabeceras simuladas...");

        const response = await fetch(ZIP_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Referer': 'https://contrataciondelestado.es/sindicacion/sindicacion64/licitacionesPerfilContratante3.atom',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });

        // ... resto del código igual ...

        if (!response.ok) {
            throw new Error(`Error HTTP del servidor: ${response.status} - ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Verificación de seguridad: Un archivo ZIP válido siempre empieza por los bytes "PK" (0x50 0x4B)
        if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
            const textPreview = buffer.toString('utf8', 0, 300);
            throw new Error(`El servidor no ha devuelto un ZIP válido. Contenido recibido (posible bloqueo o HTML):\n${textPreview}`);
        }

        console.log("Descarga completada con éxito. Descomprimiendo archivo ZIP...");
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

        const entries = jsonObj.feed?.entry || [];
        const listaEntradas = Array.isArray(entries) ? entries : [entries];

        console.log(`Se han encontrado ${listaEntradas.length} elementos en el feed. Procesando...`);

        const licitacionesParaGuardar = [];

        for (const entry of listaEntradas) {
            const numExpediente = entry['cac-place-ext:ContractFolderStatus']?.['cbc:ContractFolderID'] || entry.id;
            const objeto = entry.title?.['#text'] || entry.title || 'Sin objeto especificado';
            const urlLicitacion = entry.link?.['@_href'] || '';
            
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

        const tamanoLote = 500;
        for (let i = 0; i < licitacionesParaGuardar.length; i += tamanoLote) {
            const lote = licitacionesParaGuardar.slice(i, i + tamanoLote);

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
