const { navigation, scenes } = window.craftLayout;
const stage = document.querySelector(".stage");
const backgrounds = stage.querySelector(".backgrounds");
const objects = stage.querySelector(".objects");
const captions = stage.querySelector(".captions");
const footers = stage.querySelector(".footers");
const tabs = [...document.querySelectorAll("[data-tab]")];
const width = 5760;
const height = 3600;

function place(element, [x, y, w, h], parentWidth = width, parentHeight = height) {
  element.style.left = `${100 * x / parentWidth}%`;
  element.style.top = `${100 * y / parentHeight}%`;
  element.style.width = `${100 * w / parentWidth}%`;
  element.style.height = `${100 * h / parentHeight}%`;
}

function graphic(file, alt = "", priority = "auto") {
  const img = new Image();
  img.fetchPriority = priority;
  img.src = `./assets/${file}`;
  img.alt = alt;
  img.draggable = false;
  return img;
}

for (const tab of tabs) {
  const { hit, normal, selected } = navigation[tab.dataset.tab];
  tab.style.left = `${100 * hit[0] / width}%`;
  tab.style.width = `${100 * hit[1] / width}%`;
  for (const [state, item] of [[false, normal], [true, selected]]) {
    const [x, y, w, h] = item.rect;
    const img = graphic(item.file);
    img.dataset.selected = String(state);
    place(img, [x - hit[0], y, w, h], hit[1], 440);
    tab.append(img);
  }
}

// Shared layers keep the textile still as the silk and captions change.
const fixedLayers = new Map();
function fixedLayer(container, item, priority) {
  const key = JSON.stringify(item);
  if (!fixedLayers.has(key)) {
    const img = graphic(item.file, "", priority);
    img.className = "layer";
    if (item.brightness) img.style.filter = `brightness(${item.brightness})`;
    place(img, item.rect);
    container.append(img);
    fixedLayers.set(key, img);
  }
  return fixedLayers.get(key);
}

const loaded = new Map();
const steps = scenes.map((scene, index) => {
  const priority = index === 0 ? "high" : "low";
  const bg = fixedLayer(backgrounds, scene.background, priority);
  const footer = fixedLayer(footers, scene.footer);
  const caption = graphic(scene.caption.file, scene.caption.alt);
  caption.className = "layer caption";
  caption.setAttribute("aria-hidden", "true");
  place(caption, scene.caption.rect);
  captions.append(caption);

  let object = objects.lastElementChild;
  if (index !== 1) {
    object = document.createElement("button");
    object.className = "object";
    object.type = "button";
    object.disabled = true;
    object.setAttribute("aria-label", scene.action);
    object.append(graphic(scene.object.file, "", priority));
    place(object, scene.object.rect);
    objects.append(object);
  }
  return { bg, footer, caption, object };
});

let active = 0;
let generation = 0;
let settling = false;
let captionTimer;
let drag = null;
let progress = 0;
let ignoreClick = false;
const ribbon = steps[0].object;
const ribbonStart = scenes[0].object.rect;
const ribbonEnd = scenes[1].object.rect;

function captionVisible(caption, visible) {
  caption.classList.toggle("visible", visible);
  caption.setAttribute("aria-hidden", String(!visible));
}

function hideCaptions() {
  clearTimeout(captionTimer);
  for (const { caption } of steps) captionVisible(caption, false);
}

function showCaption(delay = 80) {
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => {
    if (!stage.hidden && !drag && !settling && (active !== 0 || progress === 0)) {
      captionVisible(steps[active].caption, true);
    }
  }, delay);
}

function setRibbon(value) {
  progress = Math.min(1, Math.max(0, value));
  place(ribbon, ribbonStart.map((start, axis) => start + (ribbonEnd[axis] - start) * progress));
  ribbon.classList.toggle("drag-ready", progress < 1);
  ribbon.setAttribute("aria-label", scenes[progress === 1 ? 1 : 0].action);
}

function selectLayers(index) {
  const current = steps[index];
  for (const layer of fixedLayers.values()) {
    layer.classList.toggle("visible", layer === current.bg || layer === current.footer);
  }
  for (const object of objects.children) {
    object.classList.toggle("visible", object === current.object);
    object.disabled = object !== current.object;
  }
}

function ready(index) {
  if (!loaded.has(index)) {
    const { bg, footer, object, caption } = steps[index];
    loaded.set(index, Promise.allSettled([bg, footer, object.firstChild, caption].map(img => img.decode())));
  }
  return loaded.get(index);
}

function reset() {
  const token = ++generation;
  if (drag && ribbon.hasPointerCapture(drag.id)) ribbon.releasePointerCapture(drag.id);
  drag = null;
  hideCaptions();
  settling = false;
  active = 0;
  stage.classList.add("instant");
  ribbon.classList.remove("dragging");
  for (const object of objects.children) object.classList.remove("dropping");
  setRibbon(0);
  selectLayers(0);
  void stage.offsetWidth;
  stage.classList.remove("instant");
  ready(0).then(() => {
    if (token === generation) showCaption();
  });
}

async function advance() {
  if (settling || active === 0 || active === steps.length - 1) return;
  const previous = steps[active].object;
  const keepFocus = document.activeElement === previous;
  const next = active + 1;
  const token = ++generation;
  settling = true;
  hideCaptions();
  await ready(next);
  if (token !== generation) return;

  const drop = next === 4;
  const incoming = steps[next].object;
  if (drop) incoming.classList.add("dropping");
  active = next;
  selectLayers(active);
  if (keepFocus) incoming.focus({ preventScroll: true });
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => {
    if (token !== generation) return;
    incoming.classList.remove("dropping");
    settling = false;
    showCaption();
  }, reduced ? 20 : drop ? 670 : 540);
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const item of tabs) item.setAttribute("aria-pressed", String(item === tab));
    stage.hidden = tab.dataset.tab !== "craft";
    reset();
  });
}

for (const object of objects.children) {
  object.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || settling) return;
    ignoreClick = false;
    if (active < steps.length - 1) hideCaptions();
    if (object !== ribbon || active !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, start: progress, moved: false };
    ribbon.setPointerCapture(event.pointerId);
    ribbon.classList.add("dragging");
  });

  object.addEventListener("pointerup", event => {
    if (!event.isPrimary || event.button !== 0) return;
    if (object === ribbon && drag?.id === event.pointerId) {
      ignoreClick = drag.moved;
      drag = null;
      ribbon.classList.remove("dragging");
      if (progress === 1) active = 1;
    }
  });

  object.addEventListener("pointercancel", () => {
    if (object === ribbon) {
      drag = null;
      ribbon.classList.remove("dragging");
      if (progress === 1) active = 1;
    }
    showCaption();
  });

  object.addEventListener("click", event => {
    if (object !== steps[active].object) return;
    if (event.detail && ignoreClick) {
      ignoreClick = false;
      return;
    }
    if (active === 0 && !event.detail) {
      hideCaptions();
      setRibbon(1);
      active = 1;
      showCaption();
      return;
    }
    advance();
  });
}

ribbon.addEventListener("pointermove", event => {
  if (!drag || drag.id !== event.pointerId) return;
  const distance = drag.x - event.clientX;
  if (!drag.moved && Math.abs(distance) < 3) return;
  drag.moved = true;
  setRibbon(drag.start + distance / (stage.clientWidth * .34));
});

window.addEventListener("pointerup", event => {
  if (event.isPrimary && event.button === 0 && !steps[active].caption.classList.contains("visible")) {
    showCaption();
  }
});

reset();
