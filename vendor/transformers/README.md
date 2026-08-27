# transformers.js (incorporado)

Librería de Hugging Face que corre modelos de IA dentro del navegador.
Se usa para transcribir grabaciones ya guardadas, sin servidor.

- Paquete: `@huggingface/transformers` 3.7.6
- Licencia: Apache-2.0 (ver LICENSE)
- Se guarda acá en vez de traerla de un CDN para que la app siga siendo
  autocontenida y funcione sin conexión una vez descargada.

Los pesos del modelo (Whisper) **no** están acá: los baja el navegador
desde Hugging Face la primera vez que se transcribe, y quedan en su caché.
