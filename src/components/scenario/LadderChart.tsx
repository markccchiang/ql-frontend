import {useEffect, useRef} from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

/** The ladder.
 *
 *  uPlot rather than a React charting library because a sweep redraws on every
 *  run and a spot ladder is thousands of points; it also renders a null as a
 *  gap, which is exactly what a point the engine could not supply should look
 *  like.
 */
export function LadderChart({
    x,
    y,
    label,
    xLabel,
    marker,
    onPick
}: {
    x: number[];
    y: (number | null)[];
    label: string;
    xLabel: string;
    /** The quote's current value, drawn as a rule so the ladder is read against
     *  where the market actually is. */
    marker?: number;
    onPick?: (value: number) => void;
}) {
    const host = useRef<HTMLDivElement>(null);
    const chart = useRef<uPlot | null>(null);
    const pick = useRef(onPick);
    pick.current = onPick;

    useEffect(() => {
        const element = host.current;
        if (!element) return;

        const options: uPlot.Options = {
            width: element.clientWidth || 600,
            height: element.clientHeight || 200,
            padding: [12, 12, 0, 0],
            cursor: {drag: {x: false, y: false}},
            // uPlot's x scale is a time axis by default, which renders a spot ladder
            // as timestamps in 1970.
            scales: {x: {time: false}},
            legend: {show: true, live: true},
            axes: [
                {stroke: "#909296", grid: {stroke: "#2c2e33"}, ticks: {stroke: "#2c2e33"}, label: xLabel, labelSize: 20},
                {stroke: "#909296", grid: {stroke: "#2c2e33"}, ticks: {stroke: "#2c2e33"}}
            ],
            series: [{label: xLabel}, {label, stroke: "#38d9a9", width: 2, points: {show: x.length <= 40, size: 5}, spanGaps: false}],
            plugins: marker === undefined ? [] : [markerPlugin(marker)]
        };

        chart.current = new uPlot(options, [x, y], element);

        // The click position is converted to a value and snapped to the nearest
        // point that was actually priced. Reading uPlot's cursor index instead
        // would depend on a hover having happened first, and writing an
        // interpolated x would put the market at a value nothing was priced at.
        const onClick = (event: MouseEvent) => {
            const self = chart.current;
            if (!self || !pick.current) return;
            const rect = self.over.getBoundingClientRect();
            const left = event.clientX - rect.left;
            if (left < 0 || left > rect.width) return;

            const target = self.posToVal(left, "x");
            const xs = self.data[0];
            let nearest: number | null = null;
            let best = Number.POSITIVE_INFINITY;
            for (let at = 0; at < xs.length; at += 1) {
                const candidate = xs[at];
                if (typeof candidate !== "number") continue;
                const distance = Math.abs(candidate - target);
                if (distance < best) {
                    best = distance;
                    nearest = candidate;
                }
            }
            if (nearest !== null) pick.current(nearest);
        };
        element.addEventListener("click", onClick);

        const observer = new ResizeObserver(() => {
            chart.current?.setSize({width: element.clientWidth, height: element.clientHeight});
        });
        observer.observe(element);

        return () => {
            element.removeEventListener("click", onClick);
            observer.disconnect();
            chart.current?.destroy();
            chart.current = null;
        };
    }, [x, y, label, xLabel, marker]);

    return <div ref={host} style={{width: "100%", height: "100%", minHeight: 180}} />;
}

/** A vertical rule at the quote's live value. */
function markerPlugin(at: number): uPlot.Plugin {
    return {
        hooks: {
            draw: self => {
                const left = self.valToPos(at, "x", true);
                const ctx = self.ctx;
                ctx.save();
                ctx.strokeStyle = "#fab005";
                ctx.setLineDash([4, 4]);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(left, self.bbox.top);
                ctx.lineTo(left, self.bbox.top + self.bbox.height);
                ctx.stroke();
                ctx.restore();
            }
        }
    };
}
