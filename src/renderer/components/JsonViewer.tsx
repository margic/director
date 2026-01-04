import React from 'react';

export const JsonViewer = ({ data }: { data: any }) => {
  if (data === null || data === undefined) return <span className="text-muted-foreground italic">null</span>;
  
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-muted-foreground italic">[]</span>;
    return (
      <div className="flex flex-col gap-2 mt-2">
        {data.map((item, index) => (
          <div key={index} className="pl-4 border-l-2 border-border/30">
            <div className="text-xs text-muted-foreground mb-1 font-mono">Item {index}</div>
            <JsonViewer data={item} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === 'object') {
    return (
      <div className="space-y-1">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="group">
            <div className="flex gap-2 py-1">
              <span className="font-mono text-secondary text-sm min-w-[150px] shrink-0">{key}:</span>
              <div className="flex-1 font-mono text-sm text-foreground/90 break-all">
                {typeof value === 'object' && value !== null ? (
                  <div className="mt-1 pl-2 border-l border-border/30">
                    <JsonViewer data={value} />
                  </div>
                ) : (
                  String(value)
                )}
              </div>
            </div>
            <div className="h-px bg-border/20 group-last:hidden" />
          </div>
        ))}
      </div>
    );
  }

  return <span>{String(data)}</span>;
};
