export function coverCrop(image, frame, zoom = 1, panX = 0, panY = 0) {
  const imageWidth = Math.max(1, Number(image?.width) || 1);
  const imageHeight = Math.max(1, Number(image?.height) || 1);
  const frameWidth = Math.max(1, Number(frame?.width) || 1);
  const frameHeight = Math.max(1, Number(frame?.height) || 1);
  const safeZoom = Math.min(3, Math.max(1, Number(zoom) || 1));
  const scale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight) * safeZoom;
  const width = Math.min(imageWidth, frameWidth / scale);
  const height = Math.min(imageHeight, frameHeight / scale);
  const maxX = Math.max(0, imageWidth - width);
  const maxY = Math.max(0, imageHeight - height);
  const normalizedX = Math.min(1, Math.max(-1, Number(panX) || 0));
  const normalizedY = Math.min(1, Math.max(-1, Number(panY) || 0));
  return {
    x: maxX * (normalizedX + 1) / 2,
    y: maxY * (normalizedY + 1) / 2,
    width,
    height
  };
}
