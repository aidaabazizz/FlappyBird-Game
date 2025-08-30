import { writeFileSync } from "node:fs";

// all units relative to canvas width/height
type Pipe = Readonly<{
    gap_y: number;
    gap_height: number;
    time: number;
}>;

const randRange = (min: number, max: number): number =>
    Math.random() * (max - min) + min;

const generatePipeCSV = ({
    count,
    startPos = 2,
    posInterval = 2,
    minGapY = 0.2,
    maxGapY = 0.8,
    // birb height = 0.075
    minGapHeight = 0.2,
    maxGapHeight = 0.3,
}: {
    count: number;
    startPos?: number;
    posInterval?: number;
    duration?: number;
    minGapY?: number;
    maxGapY?: number;
    minGapHeight?: number;
    maxGapHeight?: number;
}): string => {
    const pipes: readonly Pipe[] = Array.from({ length: count }, (_, i) => {
        const gap_y = randRange(minGapY, maxGapY);
        const gap_height = randRange(minGapHeight, maxGapHeight);
        const time = startPos + i * posInterval;
        return { gap_y, gap_height, time };
    });

    return [
        ["gap_y", "gap_height", "time"],
        ...pipes.map(({ gap_y, gap_height, time }) => [
            gap_y,
            gap_height,
            time,
        ]),
    ]
        .map(xs => xs.join(","))
        .join("\n");
};

// --- Main Program ---
const outputFile = new URL("../assets/map.csv", import.meta.url);

const csv = generatePipeCSV({ count: 20 });
writeFileSync(outputFile, csv);
console.log(`CSV written to ${outputFile}`);
