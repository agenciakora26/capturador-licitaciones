import os
import requests
import xml.etree.ElementTree as ET
from datetime import datetime

# Configuración de Supabase desde variables de entorno de GitHub Actions
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

# URL del feed Atom oficial de la Plataforma de Contratación del Sector Público
FEED_URL = "https://contrataciondelestado.es/sindicacion/sindicacion64?tipo=2&estado=PUB"

def fetch_and_process_tenders():
    print("Conectando con el feed oficial de licitaciones...")
    response = requests.get(FEED_URL)
    
    if response.status_code != 200:
        print(f"Error al conectar con el feed: {response.status_code}")
        return

    # Parsear el XML/Atom recibido
    root = ET.fromstring(response.content)
    
    # Espacios de nombres habituales en Atom/PLACSP
    namespaces = {
        'atom': 'http://www.w3.org/2005/Atom',
        'cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        'cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2'
    }

    entries = root.findall('atom:entry', namespaces)
    print(f"Se han encontrado {len(entries)} entradas en el feed.")

    count_inserted = 0

    for entry in entries:
        try:
            title = entry.find('atom:title', namespaces).text
            link = entry.find('atom:link', namespaces).attrib.get('href')
            updated = entry.find('atom:updated', namespaces).text
            
            # Extraer datos básicos (ajustar según la estructura exacta del XML del Estado)
            tender_data = {
                "titulo": title,
                "enlace": link,
                "estado": "Publicada",
                "fecha_actualizacion": updated
            }

            # Enviar a Supabase mediante su API REST
            headers = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            }
            
            # Reemplaza 'licitaciones' por el nombre de tu tabla en Supabase
            supabase_response = requests.post(
                f"{SUPABASE_URL}/rest/v1/licitaciones",
                json=tender_data,
                headers=headers
            )

            if supabase_response.status_code in [200, 201]:
                count_inserted += 1
        except Exception as e:
            print(f"Error procesando una entrada: {e}")

    print(f"Proceso finalizado. Se han sincronizado {count_inserted} licitaciones.")

if __name__ == "__main__":
    fetch_and_process_tenders()
