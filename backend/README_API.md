# SPHEREx Explorer — Documentación de la API

**Versión:** 1.0.0  
**Tecnología:** Python, FastAPI, Astroquery y Astropy  
**Servicio de datos:** IRSA (NASA/IPAC)  
**Formato de respuesta:** JSON

## 1. Descripción general

SPHEREx Explorer ofrece una API REST para consultar observaciones astronómicas de SPHEREx y analizar sus productos científicos en formato FITS.

La API permite:

- Consultar observaciones a partir de coordenadas astronómicas.
- Inspeccionar la estructura de archivos FITS.
- Obtener metadatos científicos y parámetros WCS.
- Analizar estadísticamente imágenes científicas.
- Analizar la calidad de los datos mediante las extensiones VARIANCE y FLAGS.

## 2. Dirección de la API

Durante el desarrollo local, el servidor está disponible en:

```text
http://127.0.0.1:8000
```

Documentación interactiva de FastAPI:

```text
http://127.0.0.1:8000/docs
```

Prefijo de los endpoints:

```text
/api/v1
```

Todas las operaciones documentadas utilizan el método HTTP `GET` y devuelven respuestas JSON.

## 3. Endpoints

### 3.1. Estado del servicio

**Método:** `GET`  
**Ruta:** `/api/v1/estado`

Comprueba que la API está funcionando.

No requiere parámetros.

**Respuesta — 200 OK**

```json
{
  "estado": "funcionando",
  "proyecto": "SPHEREx Explorer"
}
```

### 3.2. Buscar observaciones

**Método:** `GET`  
**Ruta:** `/api/v1/observaciones`

Consulta productos de SPHEREx en IRSA alrededor de unas coordenadas astronómicas.

La búsqueda consulta las colecciones `spherex_dr1` y `spherex_qr3`.

**Parámetros de consulta**

| Parámetro | Tipo | Obligatorio | Restricciones |
|---|---|---|---|
| `ascension_recta` | float | Sí | Entre 0 y 360 grados |
| `declinacion` | float | Sí | Entre -90 y 90 grados |
| `radio` | float | No | Mayor que 0 y máximo 3600 segundos de arco. Predeterminado: 1 |

**Ejemplo**

```http
GET /api/v1/observaciones?ascension_recta=304.693508808&declinacion=42.4436872991&radio=1
```

**Respuesta — 200 OK**

```json
{
  "total": 1,
  "observaciones": [
    {
      "identificador": "2025W35_1A_0173_4D1",
      "ascension_recta": 304.6935,
      "declinacion": 42.4436,
      "coleccion": "spherex_dr1",
      "banda_espectral": "BANDA_ESPECTRAL",
      "tipo_producto": "TIPO_PRODUCTO",
      "url_acceso": "https://irsa.ipac.caltech.edu/ibe/data/...",
      "tamano_estimado": 123456
    }
  ]
}
```

Los valores son ilustrativos. La cantidad de resultados y los datos dependen de la consulta a IRSA.

**Descripción de los campos**

| Campo | Descripción |
|---|---|
| `total` | Número de observaciones devueltas |
| `observaciones` | Lista de observaciones encontradas |
| `identificador` | Identificador del producto obtenido de `obs_id` |
| `ascension_recta` | Coordenada de ascensión recta |
| `declinacion` | Coordenada de declinación |
| `coleccion` | Colección de datos SPHEREx |
| `banda_espectral` | Nombre de la banda espectral |
| `tipo_producto` | Subtipo del producto científico |
| `url_acceso` | URL de acceso al archivo FITS |
| `tamano_estimado` | Tamaño estimado del producto; puede ser `null` |

La propiedad `url_acceso` es especialmente importante: permite utilizar el producto seleccionado en los endpoints de análisis FITS.

### 3.3. Inspeccionar la estructura FITS

**Método:** `GET`  
**Ruta:** `/api/v1/observaciones/estructura-fits`

Descarga un archivo FITS desde IRSA e inspecciona sus extensiones.

Para cada extensión devuelve su índice, nombre, tipo, dimensiones y tipo de datos.

**Parámetros de consulta**

| Parámetro | Tipo | Obligatorio |
|---|---|---|
| `url_acceso` | string | Sí |

**Ejemplo**

```http
GET /api/v1/observaciones/estructura-fits?url_acceso=URL_DEL_FITS
```

**Respuesta — 200 OK**

```json
{
  "total_extensiones": 4,
  "extensiones": [
    {
      "indice": 0,
      "nombre": "PRIMARY",
      "tipo_extension": "PrimaryHDU",
      "dimensiones": null,
      "tipo_datos": null
    },
    {
      "indice": 1,
      "nombre": "IMAGE",
      "tipo_extension": "ImageHDU",
      "dimensiones": [2040, 2040],
      "tipo_datos": "float32"
    }
  ]
}
```

El ejemplo muestra dos extensiones a modo ilustrativo; el resultado real contiene todas las extensiones encontradas.

**Descripción de los campos**

| Campo | Descripción |
|---|---|
| `total_extensiones` | Número de extensiones del archivo |
| `extensiones` | Lista de extensiones |
| `indice` | Posición de la extensión dentro del FITS |
| `nombre` | Nombre de la extensión |
| `tipo_extension` | Clase HDU de Astropy |
| `dimensiones` | Dimensiones de los datos o `null` |
| `tipo_datos` | Tipo de dato NumPy o `null` |

### 3.4. Obtener metadatos FITS

**Método:** `GET`  
**Ruta:** `/api/v1/observaciones/metadatos-fits`

Obtiene información científica de las cabeceras principal y de imagen, así como los parámetros WCS disponibles.

**Parámetros de consulta**

| Parámetro | Tipo | Obligatorio |
|---|---|---|
| `url_acceso` | string | Sí |

**Ejemplo**

```http
GET /api/v1/observaciones/metadatos-fits?url_acceso=URL_DEL_FITS
```

**Respuesta — 200 OK**

```json
{
  "cabecera_principal": {},
  "cabecera_imagen": {
    "DATE-OBS": "2025-...",
    "MJD-OBS": 0,
    "BUNIT": "MJy / sr"
  },
  "parametros_wcs": {
    "RADESYS": "ICRS",
    "WCSAXES": 2,
    "CRPIX1": 1020.0,
    "CRPIX2": 1020.0,
    "CTYPE1": "RA---TAN-SIP",
    "CTYPE2": "DEC--TAN-SIP",
    "CUNIT1": "deg",
    "CUNIT2": "deg"
  }
}
```

Los valores son ilustrativos y las propiedades dependen de las cabeceras del archivo.

**Descripción de los campos**

| Campo | Descripción |
|---|---|
| `cabecera_principal` | Metadatos generales encontrados en la cabecera primaria |
| `cabecera_imagen` | Metadatos generales de la extensión IMAGE |
| `parametros_wcs` | Parámetros del sistema de coordenadas celestes |

Entre los metadatos generales que se buscan están `TELESCOP`, `INSTRUME`, `OBJECT`, `DATE-OBS`, `MJD-OBS`, `OBS_ID`, `BUNIT` y `EXPTIME`.

Los parámetros WCS pueden incluir `RADESYS`, `EQUINOX`, `WCSAXES`, `CRPIX`, `CRVAL`, `CTYPE`, `CUNIT`, `CDELT`, `CD`, `PC` y `CROTA`.

WCS (*World Coordinate System*) permite relacionar las posiciones de los píxeles de una imagen con coordenadas astronómicas.

### 3.5. Analizar una imagen FITS

**Método:** `GET`  
**Ruta:** `/api/v1/observaciones/analisis-fits`

Analiza los datos de la extensión `IMAGE` y calcula estadísticas sobre los píxeles finitos.

**Parámetros de consulta**

| Parámetro | Tipo | Obligatorio |
|---|---|---|
| `url_acceso` | string | Sí |

**Ejemplo**

```http
GET /api/v1/observaciones/analisis-fits?url_acceso=URL_DEL_FITS
```

**Respuesta — 200 OK**

```json
{
  "extension": "IMAGE",
  "dimensiones": [2040, 2040],
  "unidad": "MJy / sr",
  "total_pixeles": 4161600,
  "pixeles_validos": 4161476,
  "pixeles_no_validos": 124,
  "estadisticas": {
    "minimo": -263.5735,
    "maximo": 3451.7012,
    "media": 0.3598355,
    "mediana": 0.1648388,
    "desviacion_estandar": 8.2117863
  }
}
```

Los valores corresponden a una muestra utilizada durante las pruebas.

**Descripción de los campos**

| Campo | Descripción |
|---|---|
| `extension` | Extensión analizada, en este caso IMAGE |
| `dimensiones` | Dimensiones de la matriz de píxeles |
| `unidad` | Unidad física indicada en `BUNIT`; puede ser `null` |
| `total_pixeles` | Número total de píxeles |
| `pixeles_validos` | Número de píxeles con valores finitos |
| `pixeles_no_validos` | Número de píxeles no finitos |
| `estadisticas.minimo` | Valor mínimo |
| `estadisticas.maximo` | Valor máximo |
| `estadisticas.media` | Media aritmética |
| `estadisticas.mediana` | Mediana |
| `estadisticas.desviacion_estandar` | Desviación estándar |

### 3.6. Analizar la calidad de los datos FITS

**Método:** `GET`  
**Ruta:** `/api/v1/observaciones/analisis-calidad-fits`

Analiza las extensiones `VARIANCE` y `FLAGS` del archivo FITS.

**Parámetros de consulta**

| Parámetro | Tipo | Obligatorio |
|---|---|---|
| `url_acceso` | string | Sí |

**Ejemplo**

```http
GET /api/v1/observaciones/analisis-calidad-fits?url_acceso=URL_DEL_FITS
```

**Respuesta — 200 OK**

```json
{
  "varianza": {
    "dimensiones": [2040, 2040],
    "total_pixeles": 4161600,
    "pixeles_validos": 4161476,
    "pixeles_no_finitos": 124,
    "varianzas_negativas": 0,
    "estadisticas": {
      "minimo": 0.0000004757,
      "maximo": 261580.4375,
      "media": 0.0726675,
      "mediana": 0.0002445,
      "desviacion_estandar": 128.5323
    }
  },
  "flags": {
    "dimensiones": [2040, 2040],
    "total_pixeles": 4161600,
    "pixeles_validos": 4161600,
    "pixeles_no_validos": 0,
    "valores_distintos": 94,
    "distribucion": [
      {
        "valor": 0,
        "cantidad": 1963934,
        "porcentaje": 47.191801
      },
      {
        "valor": 2097152,
        "cantidad": 2028176,
        "porcentaje": 48.735486
      }
    ]
  }
}
```

Los datos son representativos de una muestra probada. La distribución real puede contener muchos más valores; el ejemplo solo muestra dos.

**Descripción de VARIANCE**

| Campo | Descripción |
|---|---|
| `dimensiones` | Dimensiones de la matriz |
| `total_pixeles` | Número total de píxeles |
| `pixeles_validos` | Valores finitos y no negativos |
| `pixeles_no_finitos` | Valores NaN o infinitos |
| `varianzas_negativas` | Número de valores finitos negativos |
| `estadisticas` | Estadísticas de los valores válidos |

Si no existen valores válidos, las estadísticas se devuelven como `null`.

**Descripción de FLAGS**

| Campo | Descripción |
|---|---|
| `dimensiones` | Dimensiones de la matriz |
| `total_pixeles` | Número total de píxeles |
| `pixeles_validos` | Número de valores finitos |
| `pixeles_no_validos` | Número de valores no finitos |
| `valores_distintos` | Cantidad de valores diferentes |
| `distribucion` | Lista de frecuencias de cada valor |

Cada elemento de `distribucion` contiene:

| Campo | Descripción |
|---|---|
| `valor` | Valor numérico del indicador FLAGS |
| `cantidad` | Número de píxeles con ese valor |
| `porcentaje` | Porcentaje sobre el total de valores FLAGS válidos |

**Importante:** los valores de FLAGS se devuelven sin interpretación semántica. No deben presentarse como categorías concretas de calidad sin consultar la documentación científica oficial de SPHEREx.

## 4. Códigos HTTP y errores

| Código | Significado |
|---|---|
| `200` | Petición procesada correctamente |
| `422` | Error de validación de parámetros de FastAPI |
| `502` | Error al consultar IRSA, descargar o procesar el archivo FITS |

Los errores gestionados por los endpoints tienen una respuesta como esta:

```json
{
  "detail": "Error al consultar IRSA: descripción del error"
}
```

El texto de `detail` varía según el endpoint y el error producido.

FastAPI también puede devolver errores `422` cuando faltan parámetros obligatorios o sus valores no cumplen las restricciones definidas.

## 5. Flujo de integración recomendado

El frontend debe seguir este flujo para consultar y analizar una observación:

1. Consultar `/api/v1/estado` para comprobar que el servicio está disponible.
2. Enviar las coordenadas y el radio a `/api/v1/observaciones`.
3. Mostrar los productos encontrados.
4. Permitir seleccionar una observación.
5. Recuperar su propiedad `url_acceso`.
6. Utilizar esa URL para solicitar la estructura y los metadatos FITS.
7. Solicitar el análisis de imagen y el análisis de calidad.
8. Mostrar los resultados mediante tablas, indicadores y visualizaciones.

### Diagrama de flujo

```text
Frontend
   |
   | GET /api/v1/observaciones
   | ascension_recta, declinacion, radio
   v
SPHEREx Explorer
   |
   | Consulta de productos
   v
IRSA
   |
   | Observaciones y URL de acceso
   v
Frontend
   |
   | Selección de observación
   | 
   +---- GET /estructura-fits
   |
   +---- GET /metadatos-fits
   |
   +---- GET /analisis-fits
   |
   +---- GET /analisis-calidad-fits
   |
   v
SPHEREx Explorer
   |
   | Descarga y procesamiento FITS
   v
IRSA / Astropy / NumPy
   |
   | Resultados JSON
   v
Frontend
   |
   v
Visualización científica
```

## 6. Consideraciones para el frontend

- Todas las peticiones se realizan mediante `GET`.
- Los parámetros se envían en la URL como parámetros de consulta.
- Las URL FITS deben codificarse correctamente al incluirlas como parámetros.
- El frontend debe utilizar la propiedad `url_acceso` devuelta por la búsqueda.
- Los resultados de los análisis deben leerse respetando la estructura anidada de sus respuestas.
- Las estadísticas de imagen se encuentran dentro de `estadisticas`.
- Las estadísticas de VARIANCE también se encuentran dentro de `estadisticas`.
- La distribución de FLAGS es una lista dentro de `flags.distribucion`.
- La propiedad `unidad` puede ser `null`.
- Los campos de las cabeceras FITS dependen del producto seleccionado.
- Las operaciones que descargan y procesan archivos FITS pueden tardar más que una consulta sencilla.
- El frontend debe contemplar errores HTTP `422` y `502`.

## 7. Resumen de endpoints

| Método | Ruta | Funcionalidad |
|---|---|---|
| GET | `/api/v1/estado` | Comprobar estado |
| GET | `/api/v1/observaciones` | Buscar observaciones |
| GET | `/api/v1/observaciones/estructura-fits` | Inspeccionar FITS |
| GET | `/api/v1/observaciones/metadatos-fits` | Obtener metadatos |
| GET | `/api/v1/observaciones/analisis-fits` | Analizar imagen |
| GET | `/api/v1/observaciones/analisis-calidad-fits` | Analizar calidad |

---

**SPHEREx Explorer — API REST v1.0.0**  
Documentación técnica para el desarrollo y la integración del frontend.