# Sistema Clínico Digital Interoperable — Despliegue

## Conectarse al servidor

```bash
ssh root@24.144.105.184
```

```bash
cd ~/Sistema-Cl-nico-Digital-Interoperable
```

---

## Levantar el sistema

```bash
docker compose up -d
```

> ⚠️ MLflow y fhir-server están apagados por defecto (consumen demasiados recursos).
> Si los necesitas: `docker compose start fhir-server mlflow`

---

## URLs del sistema

| Servicio | URL | Para qué sirve |
|---|---|---|
| Frontend | http://24.144.105.184:3000 | Interfaz clínica completa |
| Backend Swagger | http://24.144.105.184:8000/docs | Probar endpoints directamente |
| ML Service | http://24.144.105.184:8001/docs | Endpoints del modelo tabular |
| DL Service | http://24.144.105.184:8002/docs | Endpoints del modelo de imágenes |
| Orchestrator | http://24.144.105.184:8003/docs | Cola de inferencias |
| MinIO Console | http://24.144.105.184:9001 | Ver imágenes almacenadas |
| Mailhog | http://24.144.105.184:8025 | Ver emails de alertas críticas |
| MLflow | http://24.144.105.184:5000 | Métricas de entrenamiento (apagado) |

---

## Credenciales — Staff

| Usuario | Rol | Access Key | Permission Key |
|---|---|---|---|
| admin | ADMIN | admin-access-key-001 | admin-perm-key-001 |
| medico1 | MEDICO | 2aca485d4737d306c54855e7658e4676 | 32002b84b268b49ab1909fbca76323e0 |
| medico3 | MEDICO | b9beafe1f1fecec10ce8082a351b67ac | 427308ff69e8dcec9a4b7a177ba641b2 |

---

## Credenciales — Pacientes

| Paciente | Usuario | X-Access-Key | X-Permission-Key |
|---|---|---|---|
| Leidy Hurtado Tamayo | leidyhurtadotamayo | 4043ed12eb69b7832b40d1941109385e | e4609b9c8d7242530aa769b6a47551b3 |
| Eduardo Serna Peña | eduardosernapena | de08861d3425b680d8e081c0a56d3e4f | fc3afc1e8b8782088186f181282b96bf |
| Dahiana Beatriz Zambrano | dahianabeatrizzambra | eca70f80ad17580309b4801c923093f4 | 94227756e1a1ce11ddd8a5ad14d741ad |
| Juan Meza | juanmeza | 52ea50ab9fd9dc530d0a7e931bfd27e1 | 64ab8a8ffe9cf0b64e8719bcdc338fea |
| Alfonso Danilo Beltrán Molina | alfonsodanilobeltran | f0d5420d6bb4dbfb8dff4cf2953641fd | 7c5857c1e2818fd62e2ba968260e9a7f |
| Aida Zapata | aidazapata | bd600f492e588325240be1b5651ff0bc | c9882d7beb31ce6c90e5c31f7cb06934 |