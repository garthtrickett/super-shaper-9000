import { expect, fixture, html } from '@open-wc/testing';
import sinon from 'sinon';
import './library-modal';
import type { LibraryModal } from './library-modal';
import { saveBoardToLibrary } from '../../lib/client/library-store';
import { INITIAL_STATE } from '../pages/board-builder-page.logic';

describe('LibraryModal UI Component', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders empty library state correctly', async () => {
    const el = await fixture<LibraryModal>(html`<library-modal></library-modal>`);
    expect(el.textContent).to.include('Library is empty');
  });

  it('renders saved library entries and handles load click', async () => {
    const entryId = saveBoardToLibrary('My test custom fish', INITIAL_STATE);

    const el = await fixture<LibraryModal>(html`<library-modal></library-modal>`);
    await el.updateComplete;

    expect(el.textContent).to.include('My test custom fish');

    // Test Load click
    const loadSpy = sinon.spy();
    el.addEventListener('import-json', loadSpy);

    const loadBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Load');
    expect(loadBtn).to.exist;
    loadBtn!.click();

    expect(loadSpy.calledOnce).to.be.true;
    expect(loadSpy.firstCall.args[0].detail.state).to.exist;

    // Test close emit on Load
    const closeSpy = sinon.spy();
    el.addEventListener('close', closeSpy);
    loadBtn!.click();
    expect(closeSpy.calledOnce).to.be.true;
  });

  it('emits close event when close button is clicked', async () => {
    const el = await fixture<LibraryModal>(html`<library-modal></library-modal>`);
    const spy = sinon.spy();
    el.addEventListener('close', spy);

    const headerClose = el.querySelector('button')!;
    headerClose.click();

    expect(spy.calledOnce).to.be.true;
  });
});
