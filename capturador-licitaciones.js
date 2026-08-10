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

const ATOM_URL = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";

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
            throw new Error(`Error HTTP del servidor oficial: ${response.status} - ${response.statusText}`);
        }

        const xmlData = await response.text();

        if (!xmlData || xmlData.trim().startsWith('<html') || xmlData.includes('Redireccionando')) {
            throw new Error("El contenido recibido no es un XML válido (posible bloqueo o redirección).");
        }

        console.log("Parseando contenido XML del feed...");
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });
        const jsonObj = parser.parse(xmlData);

        const entries = jsonObj.feed?.entry || [];
        const listaEntradas = Array.isArray(entries) ? entries : [entries];

        console.log(`Se han encontrado ${listaEntradas.length} elementos en el feed. Procesando registros con detalle...`);

        const licitacionesParaGuardar = [];

        for (const entry of listaEntradas) {
            const status = entry['cac-place-ext:ContractFolderStatus'] || {};
            const project = status['cac:ProcurementProject'] || {};

            // 1. Número de expediente
            const numExpediente = 
                status['cbc:ContractFolderID'] || 
                entry['cbc:ContractFolderID'] || 
                entry.id;

            // 2. Objeto del contrato
            const objeto = 
                project['cbc:Name'] || 
                entry.title?.['#text'] || 
                entry.title || 
                'Sin objeto especificado';

            // 3. Presupuesto base
            let presupuesto = null;
            const budgetNode = project['cbc:BudgetAmount'] || status['cbc:BudgetAmount'];
            if (budgetNode) {
                const rawPresupuesto = typeof budgetNode === 'object' ? 
                    (budgetNode['cbc:TaxExclusiveAmount'] || budgetNode['cbc:TotalAmount'] || budgetNode['#text']) : budgetNode;
                if (rawPresupuesto) {
                    presupuesto = parseFloat(rawPresupuesto) || null;
                }
            }

            // 4. Tipo de contrato
            const tipoContrato = project['cbc:TypeCode'] || null;

            // 5. Código CPV
            let codigoCpv = null;
            const cpvNode = project['cac:RequiredCommodityClassification']?.['cbc:ItemClassificationCode'];
            if (cpvNode) {
                codigoCpv = typeof cpvNode === 'object' ? (cpvNode['#text'] || null) : String(cpvNode);
            }

            // 6. Fecha fin de oferta
            let fechaFin = null;
            const deadlineNode = status['cac:TenderSubmissionDeadlinePeriod']?.['cbc:EndDate'];
            if (deadlineNode) {
                fechaFin = typeof deadlineNode === 'object' ? (deadlineNode['#text'] || null) : String(deadlineNode);
            }

            // 7. Provincia
            let provincia = null;
            const addressNode = status['cac-place-ext:LocatedContractingParty']?.['cac:Party']?.['cac:PostalAddress'];
            if (addressNode) {
                provincia = addressNode['cbc:CountrySubentity'] || addressNode['cbc:CityName'] || null;
            }

            // 8. Estado oficial
            const estado = status['cbc:ContractFolderStatusCode'] || 'Publicada';

            // 9. URL de la licitación
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
                    presupuesto_base: presupuesto,
                    tipo_contrato: tipoContrato ? String(tipoContrato).trim() : null,
                    codigo_cpv: codigoCpv ? String(codigoCpv).trim() : null,
                    fecha_fin_oferta: fechaFin ? String(fechaFin).trim() : null,
                    provincia: provincia ? String(provincia).trim() : null,
                    estado_oficial: String(estado).trim(),
                    url_licitacion: String(urlLicitacion).trim(),
                    origen: 'PLACSP'
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

        console.log(`¡Proceso completado con éxito! Sincronizados y enriquecidos ${licitacionesParaGuardar.length} registros en Supabase.`);

    } catch (err) {
        console.error("Error crítico durante la ejecución del script:", err);
        process.exit(1);
    }
}

ejecutarCaptura();
