import { createClient } from '@supabase/supabase-js';
import { XMLParser } from 'fast-xml-parser';
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

// URL del feed ATOM oficial (este endpoint sí permite el acceso directo sin bloqueos de ZIP)
const ATOM_URL = "https://contrataciondelestado.es/sindicacion/sindicacion64/licitacionesPerfilContratante3.atom";

async function ejecutarCaptura() {
    console.log("Iniciando descarga del feed ATOM oficial...");

    try {
        const response = await fetch(ATOM_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'application/atom+xml,application/xml,text/xml,*/*'
            }
        });

        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status} - ${response.statusText}`);
        }

        const xmlData = await response.text();

        // Verificamos que no nos hayan devuelto HTML por seguridad
        if (xmlData.trim().startsWith('<html') || xmlData.includes('Redireccionando')) {
            throw new Error("El servidor ha bloqueado la petición devolviendo una página HTML.");
        }

        console.log("Parseando contenido XML del feed...");
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const jsonObj = parser.parse(xmlData);

        const entries = jsonObj.feed?.entry || [];
        const listaEntradas = Array.isArray(entries) ? entries : [entries];

        console.log(`Se han encontrado ${listaEntradas.length} elementos en el feed. Procesando registros...`);

        const licitacionesParaGuardar = [];

        for (const entry of listaEntradas) {
            const numExpediente = 
                entry['cac-place-ext:ContractFolderStatus']?.['cbc:ContractFolderID'] || 
                entry['cbc:ContractFolderID'] || 
                entry.id;

            const objeto = 
                entry.title?.['#text'] || 
                entry.title || 
                'Sin objeto especificado';

            let urlLicitacion = '';
            if (entry.link) {
                if (Array.isArray(entry.link)) {
                    const linkObj = entry.link.find(l => l['@_rel'] === 'alternate' || !l['@_rel']) || entry.link[0];
                    urlLicitacion = linkObj?.['@_href'] || '';
                } else if (typeof entry.link === 'object') {
                    urlLicitacion = entry.link['@_href'] || '';
                }
            }

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
            console.log("No hay licitaciones válidas para insertar en este lote.");
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
