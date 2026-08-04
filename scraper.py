import os
from curl_cffi import requests
import xml.etree.ElementTree as ET
from datetime import datetime

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

FEED_URL = "https://contrataciondelestado.es/sindicacion/sindicacion64?tipo=2&estado=PUB"

def fetch_and_process_tenders():
    print("Conectando con el feed oficial mediante suplantación de huella TLS de Chrome...")
    
    try:
        # curl_cffi clona el comportamiento criptográfico de un navegador real de escritorio
        response = requests.get(FEED_URL, impersonate="chrome120", timeout=30)
    except Exception as e:
        print(f"Error de conexión o timeout: {e}")
        return
    
    if response.status_code != 200:
        print(f"Error HTTP del servidor: {response.status_code}")
        return

    content_text = response.text.strip()
    
    # Comprobar si el servidor devuelve HTML de bloqueo
    if content_text.startswith("<!DOCTYPE") or content_text.startswith("<html"):
        print("Error: El servidor sigue bloqueando la petición.")
        print(content_text[:300])
        return

    try:
        root = ET.fromstring(response.content)
    except ET.ParseError as e:
        print(f"Error al parsear el XML: {e}")
        return

    namespaces = {
        'atom': 'http://www.w3.org/2005/Atom'
    }

    entries = root.findall('atom:entry', namespaces)
    print(f"Se han encontrado {len(entries)} entradas totales en el feed.")

    today_str = datetime.now().strftime('%Y-%m-%d')
    print(f"Filtrando licitaciones con fecha de hoy: {today_str}")

    count_inserted = 0

    for entry in entries:
        try:
            title_elem = entry.find('atom:title', namespaces)
            link_elem = entry.find('atom:link', namespaces)
            updated_elem = entry.find('atom:updated', namespaces)
            
            title = title_elem.text if title_elem is not None else "Sin título"
            link = link_elem.attrib.get('href') if link_elem is not None else ""
            updated = updated_elem.text if updated_elem is not None else ""
            
            entry_date = updated[:10] if len(updated) >= 10 else ""

            if entry_date == today_str:
                tender_data = {
                    "titulo": title,
                    "enlace": link,
                    "estado": "Publicada",
                    "fecha_actualizacion": updated
                }

                headers = {
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates"
                }
                
                # Usamos requests estándar de python para la API REST de Supabase
                import requests as std_requests
                supabase_response = std_requests.post(
                    f"{SUPABASE_URL}/rest/v1/licitaciones",
                    json=tender_data,
                    headers=headers,
                    timeout=10
                )

                if supabase_response.status_code in [200, 201]:
                    count_inserted += 1
                else:
                    print(f"Aviso Supabase: {supabase_response.status_code} - {supabase_response.text}")
        except Exception as e:
            print(f"Error procesando una entrada: {e}")

    print(f"Proceso finalizado. Se han sincronizado {count_inserted} licitaciones del día {today_str}.")

if __name__ == "__main__":
    fetch_and_process_tenders()
