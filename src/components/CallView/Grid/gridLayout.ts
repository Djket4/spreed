/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Align with var(--grid-gap) in CallView
export const GRID_GAP = 8

// Minimum size of a video tile, in px. The "compact" variants are used when the
// grid is shown as a stripe or inside the sidebar.
export const MIN_TILE_WIDTH = 320
export const MIN_TILE_HEIGHT = 240
export const MIN_TILE_WIDTH_COMPACT = 200
// A compact tile has to fit in what is left of the stripe once the padding of
// its grid is taken out, see STRIPE_HEIGHT
export const MIN_TILE_HEIGHT_COMPACT = 134

// Height of the stripe, in px. Align with var(--stripe-height) in VideosGrid
export const STRIPE_HEIGHT = 150

// Aspect ratio (width / height) the layout tries to reach for each tile.
export const TARGET_ASPECT_RATIO = 1.5

/**
 * Minimum tile width for the given layout mode.
 *
 * @param compact - whether the grid is shown as a stripe or in the sidebar
 */
export function getMinTileWidth(compact: boolean): number {
	return compact ? MIN_TILE_WIDTH_COMPACT : MIN_TILE_WIDTH
}

/**
 * Minimum tile height for the given layout mode.
 *
 * @param compact - whether the grid is shown as a stripe or in the sidebar
 */
export function getMinTileHeight(compact: boolean): number {
	return compact ? MIN_TILE_HEIGHT_COMPACT : MIN_TILE_HEIGHT
}

type RowDistributionOptions = {
	/** Number of tiles laid out on the page, including the local video tile */
	totalTiles: number
	/** Number of rows of the grid */
	rows: number
}

/**
 * Number of tiles of each row of the grid, from the first row to the last one.
 *
 * The tiles are spread as evenly as possible: every row holds
 * `floor(totalTiles / rows)` tiles and the `totalTiles % rows` remaining tiles
 * are handed out one by one. Filling the rows one after the other instead would
 * leave every extra tile in the last row, so 7 tiles over 3 rows would be laid
 * out as 3-3-1 rather than 2-3-2.
 *
 * The extra tiles are handed out from the second row onwards, the first row
 * being served last, so that the fuller rows sit towards the middle of the grid
 * and its silhouette stays symmetric: 7 tiles give 2-3-2 and 13 tiles give
 * 3-4-3-3. This ordering is purely cosmetic, the number of tiles per row is
 * decided above.
 *
 * @param options - the layout inputs
 * @param options.totalTiles - number of tiles on the page, including the local video tile
 * @param options.rows - number of rows of the grid
 * @return the number of tiles of each row. Rows that would be left empty are
 *   dropped, so the result may be shorter than `rows`.
 */
export function computeRowDistribution({ totalTiles, rows }: RowDistributionOptions): number[] {
	// Never spread the tiles over more rows than there are tiles
	const usedRows = Math.min(rows, totalTiles)
	if (usedRows <= 0) {
		return []
	}

	const base = Math.floor(totalTiles / usedRows)
	const remainder = totalTiles % usedRows

	const distribution = new Array<number>(usedRows)
	for (let index = 0; index < usedRows; index++) {
		// Rows in the order they receive one of the `remainder` extra tiles: from
		// the second row of the grid down to the last one, and the first row last
		const row = (index + 1) % usedRows
		distribution[row] = index < remainder ? base + 1 : base
	}

	return distribution
}

/**
 * Number of grid columns a single tile spans.
 *
 * Every column of the grid is laid out as two half columns, so that a row
 * holding an odd number of empty columns can be centered by starting it half a
 * column further, on a grid line rather than with a pixel offset.
 */
export const TILE_COLUMN_SPAN = 2

/**
 * Number of half columns the grid template needs for the given number of tile
 * columns.
 *
 * @param columns - number of tile columns of the grid
 */
export function getHalfColumnCount(columns: number): number {
	return columns * TILE_COLUMN_SPAN
}

/**
 * Minimum width of a half column, in px, for the given minimum tile width.
 *
 * A tile spans two half columns and the gap between them, so each half column
 * only has to hold half of the tile minus that gap.
 *
 * @param minTileWidth - minimum width of a whole tile in px
 */
export function getHalfColumnMinWidth(minTileWidth: number): number {
	return Math.max((minTileWidth - GRID_GAP) / TILE_COLUMN_SPAN, 0)
}

type TilePlacementOptions = {
	/** Number of tiles laid out on the page, including the local video tile */
	totalTiles: number
	/** Number of rows of the grid */
	rows: number
	/** Number of columns of the grid */
	columns: number
}

/** Placement of a single tile in the CSS grid */
export type TilePlacement = {
	/** 1-based index of the row the tile belongs to */
	row: number
	/** 1-based index of the half column the tile starts at */
	column: number
}

/**
 * Placement of each tile of the grid, in the order the tiles are rendered.
 *
 * The tiles are spread across the rows by {@link computeRowDistribution} and
 * each row is then centered horizontally: the columns left empty by that row are
 * split evenly on both sides. A row leaving an odd number of columns empty has
 * to be shifted by half a column, which is why the grid is laid out in half
 * columns: the shift is then just another grid line, and every placement stays a
 * whole number handled by the grid itself.
 *
 * @param options - the layout inputs
 * @param options.totalTiles - number of tiles on the page, including the local video tile
 * @param options.rows - number of rows of the grid
 * @param options.columns - number of columns of the grid
 * @return the placement of each tile, indexed by its rendering order. Empty if
 *   the grid has not been measured yet or cannot hold every tile.
 */
export function computeTilePlacements({
	totalTiles,
	rows,
	columns,
}: TilePlacementOptions): TilePlacement[] {
	// Nothing to place yet, or a grid too small to hold every tile: fall back to
	// the default placement of the browser
	if (totalTiles <= 0 || rows <= 0 || columns <= 0 || totalTiles > rows * columns) {
		return []
	}

	const placements: TilePlacement[] = []

	for (const [index, rowSize] of computeRowDistribution({ totalTiles, rows }).entries()) {
		// The half columns left empty by the row, split evenly on both of its sides
		const column = columns - rowSize + 1

		for (let tile = 0; tile < rowSize; tile++) {
			placements.push({ row: index + 1, column: column + tile * TILE_COLUMN_SPAN })
		}
	}

	return placements
}

/** Alignment of the tile columns within the grid */
export type GridJustifyContent = 'center' | 'start' | 'end'

type JustifyContentOptions = {
	/** Whether the grid is shown as a stripe */
	isStripe: boolean
	/** Number of tiles laid out on the page, including the local video tile */
	totalTiles: number
	/** Whether the local video is the only tile of the grid */
	isLocalVideoAlone: boolean
}

/**
 * Alignment of the tile columns within the grid.
 *
 * The columns no longer take the whole width once they are capped, so the grid
 * itself has to place them. They are centered, except in a stripe holding a
 * single tile: that tile keeps the side it would sit on in a fuller stripe
 * rather than moving to the middle. The local video is laid out after the
 * remote ones, so it stays at the inline end, while a lone remote tile keeps
 * the inline start the tiles are laid out from - which is where it belongs once
 * the local video is not shown as a tile.
 *
 * @param options - the layout inputs
 * @param options.isStripe - whether the grid is shown as a stripe
 * @param options.totalTiles - number of tiles on the page, including the local video tile
 * @param options.isLocalVideoAlone - whether the local video is the only tile
 */
export function getJustifyContent({
	isStripe,
	totalTiles,
	isLocalVideoAlone,
}: JustifyContentOptions): GridJustifyContent {
	if (!isStripe || totalTiles !== 1) {
		return 'center'
	}

	return isLocalVideoAlone ? 'end' : 'start'
}

// ket4tec (NAS_CLOUD#159): плитка камеры - всегда квадрат. Сетка из квадратов: перебираем число столбцов и строк,
// берём самую крупную сторону, при которой помещаются все (иначе - больше мест, дальше листание страниц).
export const MIN_TILE_SIDE = 150

/**
 *
 * @param root0
 * @param root0.gridWidth
 * @param root0.gridHeight
 * @param root0.total
 * @param root0.minSide
 */
export function computeSquareLayout({ gridWidth, gridHeight, total, minSide = MIN_TILE_SIDE }: {
	gridWidth: number
	gridHeight: number
	total: number
	minSide?: number
}): { columns: number, rows: number, side: number } {
	const need = Math.max(total, 1)
	const maxColumns = Math.max(1, Math.floor((gridWidth + GRID_GAP) / (minSide + GRID_GAP)))
	const maxRows = Math.max(1, Math.floor((gridHeight + GRID_GAP) / (minSide + GRID_GAP)))
	let best = { columns: 1, rows: 1, side: 0 }
	let bestKey = [-1, -1, 0]
	for (let columns = 1; columns <= maxColumns; columns++) {
		for (let rows = 1; rows <= maxRows; rows++) {
			const cells = columns * rows
			const side = Math.floor(Math.min(
				(gridWidth - GRID_GAP * (columns - 1)) / columns,
				(gridHeight - GRID_GAP * (rows - 1)) / rows,
			))
			const key = cells >= need ? [1, side, -cells] : [0, cells, side]
			if (key[0] > bestKey[0]
				|| (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
				best = { columns, rows, side }
				bestKey = key
			}
		}
	}
	// Even in a tiny area there must be room for the local tile and at least one other participant:
	// shrink the square below minSide rather than show nobody.
	if (need >= 2 && best.columns * best.rows < 2) {
		const wide = Math.floor(Math.min((gridWidth - GRID_GAP) / 2, gridHeight))
		const tall = Math.floor(Math.min(gridWidth, (gridHeight - GRID_GAP) / 2))
		return wide >= tall ? { columns: 2, rows: 1, side: wide } : { columns: 1, rows: 2, side: tall }
	}
	return best
}
