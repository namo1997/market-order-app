export const DataTable = ({
    columns,
    data,
    onEdit,
    onDelete,
    renderActions,
    sortBy,
    sortDir = 'asc',
    onSort,
    rowKey
}) => {
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
                    onClick={() => onEdit(row)}
                    className={`text-blue-600 hover:text-blue-900${onDelete ? ' mr-4' : ''}`}
                >
                    แก้ไข
                </button>
            )}
            {onDelete && (
                <button
                    onClick={() => onDelete(row)}
                    className="text-red-600 hover:text-red-900"
                >
                    ลบ
                </button>
            )}
        </>
    );

    return (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        {columns.map((col, index) => (
                            <th
                                key={index}
                                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
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
                                            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900"
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
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            จัดการ
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {data.length === 0 ? (
                        <tr>
                            <td
                                colSpan={columns.length + 1}
                                className="px-6 py-12 text-center text-gray-500"
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
                                        className={`px-6 py-4 text-sm text-gray-900 ${
                                            col.wrap ? 'whitespace-normal break-words' : 'whitespace-nowrap'
                                        }`}
                                    >
                                        {col.render ? col.render(row) : row[col.accessor]}
                                    </td>
                                ))}
                                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                    {renderActions ? renderActions(row) : renderDefaultActions(row)}
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
};
