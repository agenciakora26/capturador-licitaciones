import os
import requests
import xml.etree.ElementTree as ET
from datetime import datetime

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

# URL original del feed de la PLACSP
TARGET_URL = "https://contrataciondelestado.es/sindicacion/sindicacion64?tipo=2&estado=PUB"

def fetch_and_process_tenders():
    print("Conectando con el feed de la PLACSP a través de pasarela proxy...")
    
    # Utilizamos un proxy público/servicio de peticiones para sortear el bloqueo de IPs de cloud
    proxy_url = f"https://api.allorigins.win/raw?url={requests.utils.quote(TARGET_URL)}"
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    try:
        response = requests.get(proxy_url, headers=headers, timeout=30)
    except Exception as e:
        print(f"Error de conexión: {e}")
        return
    
    if response.status_code != 200:
        print(f"Error HTTP del servidor: {response.status_code}")
        return

    content_text = response.text.strip()
    
    # Comprobación de seguridad por si devuelve HTML de bloqueo
    if "<html" in content_text[:100].lower() or "refresh" in content_text.lower():
        print("Error: El servidor ha devuelto una página de bloqueo HTML.")
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

                supabase_headers = {
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {SUPABASE_KEY}",
                    "Content-Type": "application/json",
                    "Prefer": "resolution=merge-duplicates"
                }
                
                supabase_response = requests.post(
                    f"{SUPABASE_URL}/rest/v1/licitaciones",
                    json=tender_data,
                    headers=supabase_headers,
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
