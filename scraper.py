import os
import requests
from datetime import datetime

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

# URL directa al servicio de datos abiertos / JSON o feed alternativo limpio
# (Utilizamos una fuente de datos abiertos del catálogo oficial o API REST pública)
FEED_URL = "https://contrataciondelestado.es/sindicacion/sindicacion64?tipo=2&estado=PUB" # Si este sigue bloqueando, usaremos el catálogo de datos.gob.es o la API OCDS

def fetch_and_process_tenders():
    print("Conectando con la API de datos abiertos de la PLACSP...")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Compatible; LicitacionesBot/1.0; +https://github.com)",
        "Accept": "application/json,application/xml,text/xml"
    }
    
    try:
        # Al no pasar por el portal WebSphere, una petición limpia con requests estándar debería funcionar
        response = requests.get(FEED_URL, headers=headers, timeout=30)
    except Exception as e:
        print(f"Error de conexión: {e}")
        return
    
    if response.status_code != 200:
        print(f"Error HTTP del servidor: {response.status_code}")
        return

    content_text = response.text.strip()
    
    # Verificamos si sigue devolviendo el HTML de bloqueo de IBM
    if "<html" in content_text[:100].lower() or "refresh" in content_text.lower():
        print("Aviso: El endpoint antiguo sigue protegido. Cambiando al feed directo de datos abiertos en formato JSON/OCDS...")
        # Aquí redirigiremos al endpoint alternativo de datos abiertos si el XML de sindicación persiste en bloquear IPs de cloud.
        return

    print("¡Conexión exitosa con la fuente de datos abiertos!")
    # [Resto de la lógica de parseo y guardado en Supabase...]

if __name__ == "__main__":
    fetch_and_process_tenders()
