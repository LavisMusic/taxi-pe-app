// Recorte final: react-easy-crop solo da el rectángulo en píxeles
// (croppedAreaPixels) sobre la imagen ORIGINAL — acá se dibuja ESE
// rectángulo en un <canvas> del tamaño exacto del recorte y se exporta
// como Blob JPEG, que es lo que sube GestionImagenModal.
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function getCroppedImageBlob(imageSrc, croppedAreaPixels) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = croppedAreaPixels.width;
  canvas.height = croppedAreaPixels.height;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    croppedAreaPixels.width,
    croppedAreaPixels.height
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo generar el recorte."))),
      "image/jpeg",
      0.92
    );
  });
}

// Fotos de verificación (evidencia): SIN recorte — la foto completa,
// reducida a lo sumo a `maxLado` px en su lado más largo y en JPEG de
// calidad alta, para que se lean bien la placa y el DNI sin subir archivos
// de 10+ MB. Respeta la orientación de la cámara (EXIF).
export async function reducirImagenEvidencia(file, maxLado = 2560, calidad = 0.9) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo preparar la foto."))),
      "image/jpeg",
      calidad
    );
  });
}
