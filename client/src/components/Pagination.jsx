const pageSizes = [10, 25, 50, 100];

export default function Pagination({
  page,
  pageSize,
  totalItems,
  itemLabel = 'items',
  note = '',
  onPageChange,
  onPageSizeChange
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = totalItems ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, totalItems);
  const pages = [...new Set([1, totalPages, page - 1, page, page + 1])]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b);

  return (
    <div className="table-footer pagination-footer">
      <div className="pagination-info">
        <span>Showing <strong>{start}-{end}</strong> of <strong>{totalItems}</strong> {itemLabel}</span>
        <label className="page-size-control">
          Rows:
          <select aria-label={`Rows per page for ${itemLabel}`} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {pageSizes.map((size) => <option value={size} key={size}>{size}</option>)}
          </select>
        </label>
      </div>
      <div className="pagination-controls" aria-label={`${itemLabel} pages`}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>Previous</button>
        {pages.map((pageNumber, index) => (
          <span className="pagination-page-group" key={pageNumber}>
            {index > 0 && pages[index - 1] !== pageNumber - 1 && <span className="pagination-ellipsis">...</span>}
            <button
              type="button"
              className={`btn btn-sm ${page === pageNumber ? 'btn-primary' : 'btn-secondary'}`}
              aria-current={page === pageNumber ? 'page' : undefined}
              onClick={() => onPageChange(pageNumber)}
            >
              {pageNumber}
            </button>
          </span>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))}>Next</button>
      </div>
      {note && <span className="table-footer-right">{note}</span>}
    </div>
  );
}
