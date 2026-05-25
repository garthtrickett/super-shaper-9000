import { expect } from "@open-wc/testing";
import {
  getLibraryIndex,
  saveBoardToLibrary,
  loadBoardFromLibrary,
  deleteBoardFromLibrary,
} from "./library-store";
import { INITIAL_STATE } from "../../components/pages/board-builder-page.logic";

describe("LibraryStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should return an empty list when no boards are saved", () => {
    const index = getLibraryIndex();
    expect(index).to.be.an("array").that.is.empty;
  });

  it("should successfully save a board and update the index", () => {
    const boardName = "Test Custom Board";
    const id = saveBoardToLibrary(boardName, INITIAL_STATE);
    
    expect(id).to.be.a("string");

    const index = getLibraryIndex();
    expect(index.length).to.equal(1);
    expect(index[0]!.id).to.equal(id);
    expect(index[0]!.name).to.equal(boardName);
    expect(index[0]!.updatedAt).to.exist;

    const savedBoard = loadBoardFromLibrary(id);
    expect(savedBoard).to.exist;
    expect(savedBoard!.length).to.equal(INITIAL_STATE.length);
  });

  it("should successfully delete a board and remove it from the index", () => {
    const id1 = saveBoardToLibrary("Board 1", INITIAL_STATE);
    const id2 = saveBoardToLibrary("Board 2", INITIAL_STATE);

    expect(getLibraryIndex().length).to.equal(2);

    deleteBoardFromLibrary(id1);

    const index = getLibraryIndex();
    expect(index.length).to.equal(1);
    expect(index[0]!.id).to.equal(id2);

    expect(loadBoardFromLibrary(id1)).to.be.null;
    expect(loadBoardFromLibrary(id2)).to.exist;
  });

  it("should return an empty index if the index is corrupted JSON", () => {
    localStorage.setItem("super_shaper_library_index", "{ invalid json");
    const index = getLibraryIndex();
    expect(index).to.be.an("array").that.is.empty;
  });

  it("should return null if the board payload is corrupted JSON", () => {
    const id = saveBoardToLibrary("Corrupted", INITIAL_STATE);
    localStorage.setItem(`super_shaper_library_board_${id}`, "{ invalid json");
    
    const board = loadBoardFromLibrary(id);
    expect(board).to.be.null;
  });
});
import { expect } from "@open-wc/testing";
import {
  getLibraryIndex,
  saveBoardToLibrary,
  loadBoardFromLibrary,
  deleteBoardFromLibrary,
} from "./library-store";
import { INITIAL_STATE } from "../../components/pages/board-builder-page.logic";

describe("LibraryStore Unit Tests", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should return an empty list when no boards are saved", () => {
    const index = getLibraryIndex();
    expect(index).to.be.an("array").that.is.empty;
  });

  it("should successfully save a board and update the index", () => {
    const boardName = "Test Custom Board";
    const id = saveBoardToLibrary(boardName, INITIAL_STATE);
    
    expect(id).to.be.a("string");

    const index = getLibraryIndex();
    expect(index.length).to.equal(1);
    expect(index[0]!.id).to.equal(id);
    expect(index[0]!.name).to.equal(boardName);
    expect(index[0]!.updatedAt).to.exist;

    const savedBoard = loadBoardFromLibrary(id);
    expect(savedBoard).to.exist;
    expect(savedBoard!.length).to.equal(INITIAL_STATE.length);
  });

  it("should successfully delete a board and remove it from the index", () => {
    const id1 = saveBoardToLibrary("Board 1", INITIAL_STATE);
    const id2 = saveBoardToLibrary("Board 2", INITIAL_STATE);

    expect(getLibraryIndex().length).to.equal(2);

    deleteBoardFromLibrary(id1);

    const index = getLibraryIndex();
    expect(index.length).to.equal(1);
    expect(index[0]!.id).to.equal(id2);

    expect(loadBoardFromLibrary(id1)).to.be.null;
    expect(loadBoardFromLibrary(id2)).to.exist;
  });

  it("should return an empty index if the index is corrupted JSON", () => {
    localStorage.setItem("super_shaper_library_index", "{ invalid json");
    const index = getLibraryIndex();
    expect(index).to.be.an("array").that.is.empty;
  });

  it("should return null if the board payload is corrupted JSON", () => {
    const id = saveBoardToLibrary("Corrupted", INITIAL_STATE);
    localStorage.setItem(`super_shaper_library_board_${id}`, "{ invalid json");
    
    const board = loadBoardFromLibrary(id);
    expect(board).to.be.null;
  });
});

