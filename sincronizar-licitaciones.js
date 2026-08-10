import { ejecutarCapturadorLicitaciones } from './capturador-licitaciones.js';

console.log("INICIO DEL PROCESO - LICITACIONES PLACSP");

async function iniciar() {
    try {
        await ejecutarCapturadorLicitaciones();
        console.log("Proceso de licitaciones finalizado con éxito.");
        process.exit(0);
    } catch (err) {
        console.error("Error crítico en licitaciones:", err.message);
        process.exit(1);
    }
}

iniciar();
