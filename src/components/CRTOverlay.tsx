import { Component } from 'solid-js';

const CRTOverlay: Component = () => {
  return (
    <div class="crt-overlay">
      <div class="scanlines" />
      <div class="vignette" />
      <div class="flicker" />
    </div>
  );
};

export default CRTOverlay;
