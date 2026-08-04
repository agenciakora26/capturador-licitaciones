import os
import re
import requests
import xml.etree.ElementTree as ET
from datetime import datetime

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

PORTAL_URL = "https://contrataciondelestado.es/wps/portal"
FEED_URL = "https://contrataciondelestado.es/sindicacion/sindicacion64?tipo=2&estado=PUB"

def get_with_meta_refresh(session, url, headers, max_retries=3):
    """Sigue automáticamente las redirecciones por meta-refresh que impone el portal."""
    current_url = url
    for _ in range(max_retries):
        response = session.get(current_url, headers=headers, timeout=30)
        text = response.text.strip()
        
        # Comprobar si hay una etiqueta meta-refresh
        if "<meta" in text.lower() and "refresh" in text.lower():
            match = re.search(r'url=([^"\']+)', text, re.IGNORECASE)
            if match:
                redirect_url = match.group(1).strip()
                if redirect_url.startswith("/"):
                    parsed = requests.utils.urlparse(current_url)
                    redirect_url = f"{parsed.scheme}://{parsed.netloc}{redirect_url}"
                elif not redirect_url.startswith("http"):
                    parsed = requests.utils.urlparse(current_url)
                    redirect_url = f"{parsed.scheme}://{parsed.netloc}/{redirect_url}"
                
                print(f"Siguiendo redirección automática a: {redirect_url}")
                current_url = redirect_url
                continue
        break
    return response

def fetch_and_process_tenders():
    print("Iniciando sesión y superando barreras de seguridad del portal...")
    
    session = requests.Session()
    
    headers_portal = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9",
        "Referer": "https://contrataciondelestado.es/"
    }
    
    headers_feed = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9",
        "Referer": "https://contrataciondelestado.es/wps/portal"
    }
    
    try:
        # 1. Visita inicial al portal para obtener las cookies de sesión válidas
        get_with_meta_refresh(session, PORTAL_URL, headers_portal)
        
        print("Solicitando el feed XML oficial de licitaciones...")
        # 2. Petición del feed manejando cualquier redirección intermedia
        response = get_with_meta_refresh(session, FEED_URL, headers_feed)
        
    except requests.exceptions.RequestException as e:
        print(f"Error de conexión o timeout: {e}")
        return
    
    if response.status_code != 200:
        print(f"Error HTTP del servidor: {response.status_code}")
        return

    content_text = response.text.strip()
    
    if content_text.startswith("<!DOCTYPE") or content_text.startswith("<html"):
        print("Error: El servidor sigue bloqueando la petición y devuelve HTML.")
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
                
                supabase_response = requests.post(
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
