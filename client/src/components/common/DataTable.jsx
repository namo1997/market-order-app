export const DataTable = ({
    columns,
    data,
    onEdit,
    onDelete,
    renderActions,
    sortBy,
    sortDir = 'asc',
    onSort,
    rowKey,
    showActions = true,
    dense = false,
    stickyHeader = false,
    containerClassName = '',
    allowHorizontalScroll = true,
    fitColumns = false,
    // Below the `sm` breakpoint render each row as a card (label: value + actions) instead of
    // a wide table whose action buttons end up off-screen on phones.
    mobileCards = false
}) => {
    const thPaddingClass = dense ? 'px-3 py-2' : 'px-6 py-3';
    const tdPaddingClass = dense ? 'px-3 py-2' : 'px-6 py-4';
    const emptyPaddingClass = dense ? 'px-3 py-8' : 'px-6 py-12';
    const stickyClass = stickyHeader ? 'sticky top-0 z-10 bg-gray-50' : '';
    // Keep the actions column pinned to the right edge so edit/delete stay reachable when a
    // wide table scrolls horizontally on phones.
    const stickyActionsClass =
        'sticky right-0 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.25)] sm:shadow-none';
    // Tap targets: at least 32px tall on touch screens.
    const actionButtonClass =
        'inline-flex items-center justify-center min-h-[32px] min-w-[40px] px-2 rounded-md';

    const resolveRowKey = (row, index) => {
        if (typeof rowKey === 'function') {
            return rowKey(row, index);
        }
        if (rowKey && row?.[rowKey] !== undefined) {
            return row[rowKey];
        }
        return row?.id ?? row?._id ?? row?.key ?? row?.[columns?.[0]?.accessor] ?? index;
    };
    const renderDefaultActions = (row) => (
        <>
            {onEdit && (
                <button
                    type="button"
                    onClick={() => onEdit(row)}
                    className={`${actionButtonClass} text-blue-600 hover:text-blue-900 hover:bg-blue-50${onDelete ? ' mr-2' : ''}`}
                >
                    แก้ไข
                </button>
            )}
            {onDelete && (
                <button
                    type="button"
                    onClick={() => onDelete(row)}
                    className={`${actionButtonClass} text-red-600 hover:text-red-900 hover:bg-red-50`}
                >
                    ลบ
                </button>
            )}
        </>
    );

    const shouldShowActions =
        showActions && (Boolean(onEdit) || Boolean(onDelete) || Boolean(renderActions));

    const renderCell = (col, row) => (col.render ? col.render(row) : row[col.accessor]);

    const mobileCardList = mobileCards ? (
        <div className={`sm:hidden bg-white rounded-lg shadow divide-y divide-gray-200 ${containerClassName}`}>
            {data.length === 0 ? (
                <div className={`${emptyPaddingClass} text-center text-gray-500`}>ไม่พบข้อมูล</div>
            ) : (
                data.map((row, index) => (
                    <div key={resolveRowKey(row, index)} className="px-3 py-3 space-y-1">
                        {columns.map((col, colIndex) => (
                            <div key={colIndex} className="flex items-start gap-2 text-sm">
                                <span className="w-28 shrink-0 text-xs font-medium text-gray-500 pt-0.5">
                                    {col.header}
                                </span>
                                <span className="min-w-0 flex-1 break-words text-gray-900">
                                    {renderCell(col, row)}
                                </span>
                            </div>
                        ))}
                        {shouldShowActions && (
                            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 text-sm font-medium">
                                {renderActions ? renderActions(row) : renderDefaultActions(row)}
                            </div>
                        )}
                    </div>
                ))
            )}
        </div>
    ) : null;

    return (
        <>
        {mobileCardList}
        <div
            className={`${
                allowHorizontalScroll ? 'overflow-x-auto' : 'overflow-x-hidden'
            } bg-white rounded-lg shadow ${mobileCards ? 'hidden sm:block' : ''} ${containerClassName}`}
        >
            <table
                className={`${
                    fitColumns ? 'w-full table-fixed' : 'min-w-full'
                } divide-y divide-gray-200`}
            >
                <thead className="bg-gray-50">
                    <tr>
                        {columns.map((col, index) => (
                            <th
                                key={index}
                                className={`${thPaddingClass} ${stickyClass} text-left text-xs font-medium text-gray-500 uppercase tracking-wider ${
                                    fitColumns ? 'whitespace-normal break-words' : ''
                                }`}
                            >
                                {(() => {
                                    const sortKey = col.sortKey ?? col.accessor;
                                    const isSortable = Boolean(onSort && sortKey && col.sortable !== false);
                                    const isActive = sortBy === sortKey;
                                    const indicator = isActive ? (sortDir === 'asc' ? '^' : 'v') : '';

                                    if (!isSortable) return col.header;

                                    return (
                                        <button
                                            type="button"
                                            onClick={() => onSort(sortKey)}
                                            className="inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900"
                                        >
                                            <span>{col.header}</span>
                                            {indicator && (
                                                <span className="text-[10px] text-gray-400">
                                                    {indicator}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })()}
                            </th>
                        ))}
                        {shouldShowActions && (
                            <th className={`${thPaddingClass} ${stickyClass} ${stickyActionsClass} ${stickyHeader ? 'z-20' : ''} bg-gray-50 text-right text-xs font-medium text-gray-500 uppercase tracking-wider`}>
                                จัดการ
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {data.length === 0 ? (
                        <tr>
                            <td
                                colSpan={columns.length + (shouldShowActions ? 1 : 0)}
                                className={`${emptyPaddingClass} text-center text-gray-500`}
                            >
                                ไม่พบข้อมูล
                            </td>
                        </tr>
                    ) : (
                        data.map((row, index) => (
                            <tr key={resolveRowKey(row, index)} className="hover:bg-gray-50">
                                {columns.map((col, index) => (
                                    <td
                                        key={index}
                                        className={`${tdPaddingClass} text-sm text-gray-900 ${
                                            fitColumns || col.wrap
                                                ? 'whitespace-normal break-words'
                                                : 'whitespace-nowrap'
                                        }`}
                                    >
                                        {renderCell(col, row)}
                                    </td>
                                ))}
                                {shouldShowActions && (
                                    <td
                                        className={`${tdPaddingClass} ${stickyActionsClass} bg-white ${
                                            fitColumns ? 'whitespace-normal break-words' : 'whitespace-nowrap'
                                        } text-right text-sm font-medium`}
                                    >
                                        {renderActions ? renderActions(row) : renderDefaultActions(row)}
                                    </td>
                                )}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
        </>
    );
};
