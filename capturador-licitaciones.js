import { XMLParser } from 'fast-xml-parser';

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

async function supabaseRequest(endpoint, opciones = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
        ...opciones,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            ...(opciones.headers || {})
        }
    });

    if (!res.ok) {
        throw new Error(`Supabase error: ${res.status} - ${await res.text()}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

export async function ejecutarCapturadorLicitaciones() {
    console.log("📡 Descargando feed ATOM de la Plataforma de Contratación del Sector Público...");
    const urlAtom = "https://contrataciondelestado.es/sourcing/html/atom/licitacionesPerfilesContratanteCompleto3/licitacionesPerfilesContratanteCompleto3.atom";

    try {
        const respuesta = await fetch(urlAtom, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; BoletinHoy/1.0;)" }
        });

        if (!respuesta.ok) {
            throw new Error(`HTTP ${respuesta.status}`);
        }

        const xmlData = await respuesta.text();
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_"
        });

        const jsonObj = parser.parse(xmlData);
        const entries = jsonObj.feed?.entry || [];
        const listaLicitaciones = Array.isArray(entries) ? entries : [entries];
        
        console.log(`📌 Licitaciones encontradas en el feed: ${listaLicitaciones.length}`);

        for (const entry of listaLicitaciones) {
            const numExpediente = entry["cbc-place-ext:ContractFolderID"] || entry.title || "";
            const objetoContrato = entry.summary || entry.title || "";
            const link = entry.link?.["@_href"] || "";
            
            const contractFolderStatus = entry["cac-place-ext:ContractFolderStatus"] || {};
            const procurementProject = contractFolderStatus["cac:ProcurementProject"] || {};
            
            const presupuesto = parseFloat(procurementProject["cac:BudgetAmount"]?.["cbc:TaxExclusiveAmount"] || 0);
            const tipoContrato = procurementProject["cbc:TypeCode"] || "Otros";
            const cpv = procurementProject["cac:RequiredCommodityClassification"]?.["cbc:ItemClassificationCode"] || "";
            const estado = contractFolderStatus["cbc-place-ext:ContractFolderStatusCode"] || "Publicada";
            
            const location = procurementProject["cac:RealizedLocation"] || {};
            const provincia = location["cbc:CountrySubentity"] || location["cac:Address"]?.["cbc:CountrySubentity"] || "Nacional / No especificada";

            const tenderProcess = contractFolderStatus["cac:TenderResult"] || contractFolderStatus["cac:TenderSubmissionDeadlinePeriod"] || {};
            const fechaFin = tenderProcess["cbc:EndDate"] || null;

            if (!numExpediente || !link) continue;

            const licitacionData = {
                num_expediente: String(numExpediente).trim(),
                objeto_contrato: String(objetoContrato).trim(),
                presupuesto_base: isNaN(presupuesto) ? 0 : presupuesto,
                tipo_contrato: String(tipoContrato).trim(),
                codigo_cpv: String(cpv).trim(),
                estado_oficial: String(estado).trim(),
                url_licitacion: String(link).trim(),
                fecha_fin_oferta: fechaFin ? new Date(fechaFin).toISOString() : null,
                provincia: String(provincia).trim(),
                origen: "PLACSP"
            };

            try {
                await supabaseRequest("licitaciones", {
                    method: "POST",
                    headers: { "Prefer": "resolution=ignore-duplicates" },
                    body: JSON.stringify(licitacionData)
                });
            } catch (err) {
                // Duplicados ignorados silenciosamente
            }
        }

        console.log("✅ Proceso de captura de licitaciones finalizado.");

    } catch (error) {
        console.error("❌ Error en capturador de licitaciones:", error.message);
    }
}
