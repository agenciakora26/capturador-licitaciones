import { createClient } from '@supabase/supabase-js';

// 1. Recogemos las credenciales que inyecta GitHub Actions de forma segura
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Faltan las credenciales de Supabase en las variables de entorno.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function capturarLicitaciones() {
    console.log("Iniciando el rastreo de licitaciones...");

    try {
        // AQUÍ DEBES IMPLEMENTAR TU LÓGICA DE SCRAPING O LLAMADA A API
        // Ejemplo simulando una licitación encontrada:
        const licitacionesNuevas = [
            {
                num_expediente: "AUTO-" + Date.now(),
                objeto_contrato: "Licitación capturada automáticamente por GitHub Actions",
                presupuesto_base: 15000.00,
                tipo_contrato: "Servicios",
                codigo_cpv: "72000000-5",
                estado_oficial: "Publicada",
                url_licitacion: "https://contrataciondelestado.es"
            }
        ];

        if (licitacionesNuevas.length === 0) {
            console.log("No se han encontrado nuevas licitaciones hoy.");
            return;
        }

        // 2. Guardamos los datos en la tabla 'licitaciones' de Supabase
        const { data, error } = await supabase
            .from('licitaciones')
            .insert(licitacionesNuevas);

        if (error) {
            console.error("Error al insertar en Supabase:", error);
            process.exit(1);
        }

        console.log(`¡Éxito! Se han guardado ${licitacionesNuevas.length} licitaciones en Supabase.`);

    } catch (err) {
        console.error("Error inesperado durante el proceso:", err);
        process.exit(1);
    }
}

capturarLicitaciones();
