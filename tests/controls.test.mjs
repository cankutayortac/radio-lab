import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as navigation from '../lib/navigation.ts';

// Exercise the production React callbacks in their actual order without a DOM
// or a browser session. UI primitives remain inert; state and refs persist.
function harness() {
  const slots = [];
  const cleanup = [];
  let cursor = 0;
  const windowEvents = new Map(),
    documentEvents = new Map();
  const events = (map) => ({
    addEventListener: (name, fn) => map.set(name, fn),
    removeEventListener: (name) => map.delete(name),
  });
  const document = { ...events(documentEvents), hidden: false };
  const hooks = {
    useId: () => 'test-angle',
    useRef: (value) => {
      const i = cursor++;
      return (slots[i] ??= { current: value });
    },
    useState: (value) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = value;
      return [
        slots[i],
        (next) => {
          slots[i] = typeof next === 'function' ? next(slots[i]) : next;
        },
      ];
    },
    useEffect: (fn) => {
      const i = cursor++;
      if (!(i in slots)) {
        slots[i] = true;
        cleanup.push(fn());
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const exported = {};
  const source = readFileSync(
    new URL('../components/trainer-controls.tsx', import.meta.url),
    'utf8',
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports: exported,
    window: events(windowEvents),
    document,
    require: (name) =>
      name === 'react'
        ? hooks
        : name === 'react/jsx-runtime'
          ? { jsx, jsxs: jsx }
          : name === '@/lib/navigation'
            ? navigation
            : new Proxy({}, { get: (_, key) => key }),
  });
  return {
    exported,
    document,
    render: (component, props) => {
      cursor = 0;
      return exported[component](props);
    },
    windowEvent: (name) => windowEvents.get(name)?.(),
    documentEvent: (name) => documentEvents.get(name)?.(),
    cleanup: () => cleanup.forEach((fn) => fn?.()),
  };
}
function find(node, type) {
  if (!node || typeof node !== 'object') return undefined;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const match = find(child, type);
    if (match) return match;
  }
}
function angle(initial = 335) {
  const h = harness();
  const writes = [];
  const props = {
    label: 'CRS · NAV1',
    value: initial,
    onChange: (v) => {
      writes.push(v);
      props.value = v;
    },
  };
  const render = () => h.render('AngleControl', props);
  return { h, props, writes, render, input: () => find(render(), 'Input') };
}
test('Untouched focus/blur never commits or rounds the selected value', () => {
  const a = angle(359.8);
  a.input().props.onFocus({ currentTarget: { select() {} } });
  assert.equal(a.input().props.value, '000');
  assert.equal(find(a.render(), a.h.exported.StableSlider).props.value, 0);
  a.input().props.onBlur();
  assert.deepEqual(a.writes, []);
});
test('Pointer-down slider change wins over the later numeric-input blur', () => {
  const a = angle();
  a.input().props.onChange({ target: { value: '120' } });
  const staleBlur = a.input().props.onBlur;
  find(a.render(), a.h.exported.StableSlider).props.onChange(90);
  staleBlur();
  assert.deepEqual(a.writes, [90]);
  assert.equal(a.input().props.value, '090');
});
test('Changing an external value or NAV identity invalidates an old draft', () => {
  for (const field of ['value', 'label']) {
    const a = angle();
    a.input().props.onChange({ target: { value: '120' } });
    a.props[field] = field === 'value' ? 270 : 'CRS · NAV2';
    a.input().props.onBlur();
    assert.deepEqual(a.writes, []);
  }
});
test('Edited angle commits once; a blank or invalid edit never sets zero/NaN', () => {
  for (const [text, expected] of [
    ['090', [90]],
    ['360', [0]],
    ['-10', [350]],
    ['', []],
    ['abc', []],
  ]) {
    const a = angle();
    a.input().props.onChange({ target: { value: text } });
    a.input().props.onBlur();
    a.input().props.onBlur();
    assert.deepEqual(a.writes, expected);
  }
});
test('Escape cancels a draft even if blur fires before the next render', () => {
  const a = angle();
  a.input().props.onChange({ target: { value: '090' } });
  const props = a.input().props;
  props.onKeyDown({ key: 'Escape', preventDefault() {} });
  props.onBlur();
  assert.deepEqual(a.writes, []);
});
test('Synchronization clears a pending input before writing a new value', () => {
  const a = angle();
  a.props.onSync = () => a.props.onChange(180);
  a.input().props.onChange({ target: { value: '090' } });
  const oldBlur = a.input().props.onBlur;
  find(a.render(), 'Button').props.onClick();
  oldBlur();
  assert.deepEqual(a.writes, [180]);
});
test('Slider uses dimension-independent center alignment after hide/show', () => {
  const h = harness();
  const render = () =>
    find(
      h.render('StableSlider', { label: 'HDG', value: 350, onChange() {} }),
      'Slider',
    );
  const first = render();
  assert.equal(first.props.thumbAlignment, 'center');
  h.windowEvent('blur');
  const second = render();
  assert.notEqual(second.key, first.key);
  assert.equal(second.props.thumbAlignment, 'center');
  assert.equal(second.props.value[0], 350);
  h.cleanup();
});
for (const reason of [
  'blur',
  'visibilitychange',
  'pointercancel',
  'touchcancel',
]) {
  test(`Canceled slider ${reason} cannot apply a ghost drag`, () => {
    const h = harness(),
      writes = [];
    const render = () =>
      find(
        h.render('StableSlider', {
          label: 'CRS',
          value: 90,
          onChange: (v) => writes.push(v),
        }),
        'Slider',
      );
    let slider = render();
    slider.props.onPointerDownCapture({ isPrimary: true, button: 0 });
    slider.props.onValueChange([110], {
      reason: 'drag',
      cancel() {
        assert.fail('active drag rejected');
      },
    });
    if (reason === 'blur') h.windowEvent(reason);
    else {
      h.document.hidden = true;
      h.documentEvent(reason);
    }
    let canceled = false;
    slider.props.onValueChange([359], {
      reason: 'drag',
      cancel() {
        canceled = true;
      },
    });
    assert.equal(canceled, true);
    assert.deepEqual(writes, [110]);
    slider = render();
    slider.props.onValueChange([111], {
      reason: 'keyboard',
      cancel() {
        assert.fail('keyboard rejected');
      },
    });
    assert.deepEqual(writes, [110, 111]);
    h.cleanup();
  });
}

const trainerText = readFileSync(
  new URL('../components/navigation-trainer.tsx', import.meta.url),
  'utf8',
);
const trainer = ts.createSourceFile(
  'trainer.tsx',
  trainerText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const releases = [];
let viewChange;
let suspendFlight, bankBlur;
function inspect(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(trainer) === 'suspend'
  )
    suspendFlight = node.initializer.getText(trainer);
  if (
    ts.isJsxAttribute(node) &&
    node.name.getText(trainer) === 'className' &&
    node.initializer?.getText(trainer) === '"bank-button"'
  ) {
    bankBlur = node.parent.properties
      .find((a) => a.name?.getText(trainer) === 'onBlur')
      .initializer.expression.getText(trainer);
  }
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(trainer) === 'release'
  )
    releases.push(node.initializer.getText(trainer));
  if (
    ts.isJsxAttribute(node) &&
    node.name.getText(trainer) === 'className' &&
    node.initializer?.getText(trainer) === '"compact-view-switch"'
  ) {
    viewChange = node.parent.properties
      .find((a) => a.name?.getText(trainer) === 'onValueChange')
      .initializer.expression.getText(trainer);
  }
  ts.forEachChild(node, inspect);
}
inspect(trainer);
test('Browser focus loss pauses without changing the selected course or heading', () => {
  const state = {
    current: {
      running: true,
      bug: 350,
      courses: [0, 90],
      ac: { heading: 342 },
    },
  };
  const context = {
    state,
    activePointer: { current: 5 },
    manual: { current: -1 },
    setNotice() {},
    change: (p) => Object.assign(state.current, p),
  };
  vm.runInNewContext(suspendFlight, context)();
  assert.equal(state.current.running, false);
  assert.equal(state.current.bug, 350);
  assert.deepEqual(state.current.courses, [0, 90]);
  assert.equal(context.manual.current, 0);
});
test('Blurring the previous bank button does not cancel a new pointer turn', () => {
  const context = { activePointer: { current: 7 }, manual: { current: 1 } };
  const callback = vm.runInNewContext(bankBlur, context);
  callback();
  assert.equal(context.manual.current, 1);
  context.activePointer.current = null;
  callback();
  assert.equal(context.manual.current, 0);
});
test('All cockpit/map/mission view switches preserve selected heading and courses', () => {
  const state = { current: { bug: 350, ac: { heading: 0 }, courses: [0, 90] } };
  const context = {
    state,
    activePointer: { current: 5 },
    manual: { current: 1 },
    setMobileView() {},
    change: (p) => Object.assign(state.current, p),
  };
  const callback = vm.runInNewContext(viewChange, context);
  for (const view of ['map', 'mission', 'cockpit']) callback(view);
  assert.equal(state.current.bug, 350);
  assert.deepEqual(state.current.courses, [0, 90]);
  assert.equal(context.manual.current, 0);
});
test('Only releasing an actual manual turn synchronizes HDG to the aircraft', () => {
  const state = { current: { bug: 350, ac: { heading: 342 } } };
  const context = {
    state,
    manual: { current: 0 },
    activePointer: { current: null },
    change: (p) => Object.assign(state.current, p),
  };
  const release = vm.runInNewContext(releases.at(-1), context);
  release();
  assert.equal(state.current.bug, 350);
  context.manual.current = -1;
  release();
  assert.equal(state.current.bug, 342);
});
