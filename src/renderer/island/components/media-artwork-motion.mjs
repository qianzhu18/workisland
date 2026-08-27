const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export function getRestingArtworkMotionVariables() {
  return {
    "--artwork-rotate-x": "0deg",
    "--artwork-rotate-y": "0deg",
    "--artwork-light-x": "50%",
    "--artwork-light-y": "50%",
    "--artwork-glow-x": "0px",
    "--artwork-glow-y": "0px"
  };
}

export function getArtworkMotionVariables({ x, y, width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return getRestingArtworkMotionVariables();
  }

  const normalizedX = clamp((Number(x) / width) * 2 - 1, -1, 1);
  const normalizedY = clamp((Number(y) / height) * 2 - 1, -1, 1);
  const lightX = (normalizedX + 1) * 50;
  const lightY = (normalizedY + 1) * 50;

  return {
    "--artwork-rotate-x": `${(-normalizedY * 5.5).toFixed(2)}deg`,
    "--artwork-rotate-y": `${(-normalizedX * 5.5).toFixed(2)}deg`,
    "--artwork-light-x": `${lightX.toFixed(2)}%`,
    "--artwork-light-y": `${lightY.toFixed(2)}%`,
    "--artwork-glow-x": `${(normalizedX * 3).toFixed(2)}px`,
    "--artwork-glow-y": `${(normalizedY * 3).toFixed(2)}px`
  };
}
