import "./style.css";

import {
    Observable,
    catchError,
    filter,
    fromEvent,
    interval,
    map,
    scan,
    switchMap,
    take,
    merge,
    of,
    takeWhile,
    startWith,
    Subject,
    withLatestFrom,
    BehaviorSubject,
} from "rxjs";
import { fromFetch } from "rxjs/fetch";

/**
 * A random number generator which provides two pure functions
 * `hash` and `scale`. Call `hash` repeatedly to generate the
 * sequence of hashes.
 * all use of RNG was HEAVILY referenced from applied 4's activity.
 */
abstract class RNG {
    private static m = 0x80000000; // 2^31
    private static a = 1103515245;
    private static c = 12345;

    public static hash = (seed: number): number =>
        (RNG.a * seed + RNG.c) % RNG.m;

    public static scale = (hash: number): number =>
        (2 * hash) / (RNG.m - 1) - 1; // in [-1, 1]
}

export function createRngStreamFromSource<T>(source$: Observable<T>) {
    return function createRngStream(seed: number = 0): Observable<number> {
        const randomNumberStream = source$.pipe(
            scan(
                (state, _) => {
                    const nextSeed = RNG.hash(state.seed);
                    const value = RNG.scale(nextSeed);
                    return { seed: nextSeed, value };
                },
                { seed, value: RNG.scale(seed) },
            ),
            map(({ value }) => value),
        );

        return randomNumberStream;
    };
}

/** Constants */

const Viewport = {
    CANVAS_WIDTH: 600,
    CANVAS_HEIGHT: 400,
} as const;

const Birb = {
    WIDTH: 42,
    HEIGHT: 30,
} as const;

const Constants = {
    PIPE_WIDTH: 50, // width of pipes
    TICK_RATE_MS: 30, // speed of bird flaps
    PIPE_SPEED: 7,
    SCORE_PER_PIPE: 1,
    INITIAL_LIVES: 3,
    BOUNCE_VELOCITY_MIN: 3, // Minimum bounce velocity
    BOUNCE_VELOCITY_MAX: 7, // Maximum bounce velocity
    MAX_GHOST_BIRDS: 4, // Maximum number of ghost birds to show
} as const;

const Physics = {
    GRAVITY: 0.5, // How fast the bird will fall
    JUMP_STRENGTH: -7, // How high the bird will jump when user presses space key
    SEED: 1234, // The intial seed value, it makes the randomness predictable and testable
} as const;

// State processing
type State = Readonly<{
    isFirstGame: boolean;
    gameEnd: boolean;
    gameVictory: boolean;
    showRestartButton: boolean;
    birdPos: {
        y: number;
        velocity: number;
    };
    score: number;
    lives: number;
    pipes: Array<{
        id: number;
        x: number;
        gapY: number;
        gapHeight: number;
        passed: boolean;
    }>;
    pipeIdCounter: number;
    bounce: {
        active: boolean;
        direction: "up" | "down";
        timer: number;
        velocity: number;
        color: boolean;
    };
    ghostBirds: Array<{
        y: number;
        visible: boolean;
        positions: number[];
        currentIndex: number;
    }>;
    currentGameData: {
        birdPositions: number[];
        currentIndex: number;
    };
    csvPipes: ReadonlyArray<{
        gapY: number;
        gapHeight: number;
        spawnTime: number;
    }>;
    gameStartTime: number;
    nextPipeIndex: number;
}>;

const MAX_RECORDED_POSITIONS = 1000; // Number of bird positions recorded during a single game

/**
 * Default state of the game
 */

const initialState: State = {
    isFirstGame: true,
    gameEnd: false,
    gameVictory: false,
    showRestartButton: false,
    birdPos: {
        y: Viewport.CANVAS_HEIGHT / 2,
        velocity: 0,
    },
    score: 0,
    lives: Constants.INITIAL_LIVES,
    pipes: [],
    pipeIdCounter: 0,
    bounce: {
        active: false,
        direction: "up",
        timer: 0,
        velocity: Constants.BOUNCE_VELOCITY_MIN,
        color: true,
    },
    ghostBirds: [],
    currentGameData: {
        birdPositions: [],
        currentIndex: 0,
    },
    csvPipes: [],
    gameStartTime: 0,
    nextPipeIndex: 0,
};

/**
 * Pure function to manage ghost data between games
 */
const createGameManager = () => {
    const ghostDataSubject = new BehaviorSubject<
        Array<{
            birdPositions: number[];
        }>
    >([]);

    return {
        getGhostData: () => ghostDataSubject.value,
        addGhostData: (data: { birdPositions: number[] }) => {
            const currentData = ghostDataSubject.value;
            // Keep only the last MAX_GHOST_BIRDS games
            const newData = [...currentData, data].slice(
                -Constants.MAX_GHOST_BIRDS,
            );
            ghostDataSubject.next(newData);
        },
        clearGhostData: () => ghostDataSubject.next([]),
        ghostData$: ghostDataSubject.asObservable(),
    };
};

const gameManager = createGameManager();

/**
 * Check if bird collides with a pipe and which part it hit
 */
const checkPipeCollision = (
    birdX: number,
    birdY: number,
    pipe: State["pipes"][0],
): { collision: boolean; hitTop: boolean } => {
    const pipeLeft = pipe.x;
    const pipeRight = pipe.x + Constants.PIPE_WIDTH;
    const pipeTopBottom = pipe.gapY - pipe.gapHeight / 2;
    const pipeBottomTop = pipe.gapY + pipe.gapHeight / 2;

    const birdLeft = birdX - Birb.WIDTH / 2;
    const birdRight = birdX + Birb.WIDTH / 2;
    const birdTop = birdY - Birb.HEIGHT / 2;
    const birdBottom = birdY + Birb.HEIGHT / 2;

    const topPipeCollision =
        birdRight > pipeLeft && birdLeft < pipeRight && birdTop < pipeTopBottom;

    const bottomPipeCollision =
        birdRight > pipeLeft &&
        birdLeft < pipeRight &&
        birdBottom > pipeBottomTop;

    return {
        collision: topPipeCollision || bottomPipeCollision,
        hitTop: topPipeCollision,
    };
};

/**
 * Parses CSV content into pipe data using functional approach
 */
const parseCSVPipes = (
    csvContent: string,
): Array<{ gapY: number; gapHeight: number; spawnTime: number }> => {
    if (csvContent === "default") {
        // Fallback: generate some default pipes using functional RNG
        const seed = Physics.SEED;
        return Array.from({ length: 10 }, (_, i) => {
            const hash = RNG.hash(seed + i);
            const scaled = RNG.scale(hash); // [-1, 1]
            const gapY =
                ((scaled + 1) / 2) * (Viewport.CANVAS_HEIGHT - 200) + 100;
            return {
                gapY,
                gapHeight: 150, // Default gap height
                spawnTime: (i + 1) * 1500, // Default timing
            };
        });
    }

    return csvContent
        .trim()
        .split("\n")
        .slice(1) // Skip header
        .filter(line => line.trim() !== "") // Remove empty lines
        .map(line => {
            const [gap_y, gap_height, time] = line.split(",").map(Number);
            return {
                gapY: gap_y * Viewport.CANVAS_HEIGHT, // Convert relative to absolute
                gapHeight: gap_height * Viewport.CANVAS_HEIGHT, // Use gap_height from CSV
                spawnTime: time * 1000, // Convert seconds to milliseconds
            };
        });
};

/**
 * Check if bird hits any boundaries top or bottom
 */
const checkBoundaryCollision = (
    birdY: number,
): { collision: boolean; hitTop: boolean } => ({
    collision:
        birdY - Birb.HEIGHT / 2 <= 0 ||
        birdY + Birb.HEIGHT / 2 >= Viewport.CANVAS_HEIGHT,
    hitTop: birdY - Birb.HEIGHT / 2 <= 0,
});

/**
 * Process pipe collisions
 */
const processPipeCollisions = (
    birdX: number,
    birdY: number,
    pipes: State["pipes"],
) =>
    pipes.reduce(
        (result, pipe) => {
            if (result.collision) return result;

            const collision = checkPipeCollision(birdX, birdY, pipe);
            return collision.collision ? collision : result;
        },
        { collision: false, hitTop: false } as {
            collision: boolean;
            hitTop: boolean;
        },
    );

/**
 * Spawns pipes based on the CSV timing data
 */
const spawnPipesFromCSV = (s: State): State => {
    if (s.gameEnd || s.gameVictory || s.nextPipeIndex >= s.csvPipes.length) {
        return s;
    }

    const currentTime = Date.now() - s.gameStartTime;
    const nextPipe = s.csvPipes[s.nextPipeIndex];

    if (currentTime >= nextPipe.spawnTime) {
        return {
            ...s,
            pipes: [
                ...s.pipes,
                {
                    id: s.pipeIdCounter,
                    x: Viewport.CANVAS_WIDTH,
                    gapY: nextPipe.gapY,
                    gapHeight: nextPipe.gapHeight,
                    passed: false,
                },
            ],
            pipeIdCounter: s.pipeIdCounter + 1,
            nextPipeIndex: s.nextPipeIndex + 1,
        };
    }

    return s;
};

/**
 * Restart function that preserves ghost data from previous games
 */
const restartGame = (s: State): State => {
    const ghostData = gameManager.getGhostData();

    return {
        ...initialState,
        isFirstGame: false,
        showRestartButton: true,
        csvPipes: s.csvPipes,
        ghostBirds: ghostData.map(data => ({
            y: data.birdPositions[0] || Viewport.CANVAS_HEIGHT / 2,
            visible: data.birdPositions.length > 0,
            positions: data.birdPositions,
            currentIndex: 0,
        })),
        gameStartTime: Date.now(),
    };
};

/**
 * Records the current bird position for future ghost birds
 */
const recordBirdPosition = (s: State): State => {
    if (s.gameEnd || s.gameVictory) {
        // When game ends, save the positions for next game
        if (s.currentGameData.birdPositions.length > 0) {
            gameManager.addGhostData({
                birdPositions: s.currentGameData.birdPositions,
            });
        }
        return s;
    }

    const newPositions = [...s.currentGameData.birdPositions, s.birdPos.y];
    const trimmedPositions =
        newPositions.length > MAX_RECORDED_POSITIONS
            ? newPositions.slice(-MAX_RECORDED_POSITIONS)
            : newPositions;

    return {
        ...s,
        currentGameData: {
            ...s.currentGameData,
            birdPositions: trimmedPositions,
            currentIndex: s.currentGameData.currentIndex + 1,
        },
    };
};

/**
 * Updates all ghost birds based on their recorded data
 */
const updateGhostBirds = (s: State): State => {
    if (s.isFirstGame || s.ghostBirds.length === 0) {
        return s;
    }

    const updatedGhostBirds = s.ghostBirds.map(ghost => {
        // Don't update if no recorded data
        if (ghost.positions.length === 0) {
            return { ...ghost, visible: false };
        }

        // Only advance the ghost during active gameplay
        if (!s.gameEnd && !s.gameVictory) {
            const nextIndex = ghost.currentIndex + 1;

            // Check if we've reached the end of recorded positions
            if (nextIndex >= ghost.positions.length) {
                return {
                    ...ghost,
                    visible: false,
                    currentIndex: nextIndex,
                };
            }

            // Update ghost position
            const ghostY = ghost.positions[nextIndex];
            return {
                ...ghost,
                y: ghostY,
                visible: true,
                currentIndex: nextIndex,
            };
        }

        return ghost;
    });

    return { ...s, ghostBirds: updatedGhostBirds };
};

/**
 * Updates the state by proceeding with one time step.
 */
const tick = (s: State, randomBounceVelocity: number): State => {
    if (s.gameEnd || s.gameVictory) {
        return s;
    }

    const birdX = Viewport.CANVAS_WIDTH * 0.3;
    const birdY = s.birdPos.y;
    const shouldEndFromScore =
        s.nextPipeIndex >= s.csvPipes.length &&
        s.pipes.every(pipe => pipe.x + Constants.PIPE_WIDTH < 0);

    // Handle bounce effect if active
    const newBounceState = s.bounce.active
        ? {
              ...s.bounce,
              timer: s.bounce.timer - 1,
              active: s.bounce.timer > 0,
          }
        : s.bounce;

    // Calculate velocity - if lives are zero, use slower bounce
    const newVelocity = s.bounce.active
        ? s.bounce.direction === "up"
            ? s.lives === 0
                ? -Constants.BOUNCE_VELOCITY_MIN / 2
                : -s.bounce.velocity
            : s.lives === 0
              ? Constants.BOUNCE_VELOCITY_MIN / 2
              : s.bounce.velocity
        : s.birdPos.velocity + Physics.GRAVITY;

    // Move pipes and update passed status using map
    const updatedPipes = s.pipes.map(pipe => ({
        ...pipe,
        x: pipe.x - Constants.PIPE_SPEED,
        passed:
            pipe.passed ||
            pipe.x + Constants.PIPE_WIDTH < birdX - Birb.WIDTH / 2,
    }));

    // Calculate new score - count newly passed pipes using filter
    const newlyPassedPipes = updatedPipes.filter(
        pipe =>
            !pipe.passed &&
            pipe.x + Constants.PIPE_WIDTH < birdX - Birb.WIDTH / 2,
    );
    const newScore =
        s.score + newlyPassedPipes.length * Constants.SCORE_PER_PIPE;

    // Remove pipes that are off-screen using filter
    const visiblePipes = updatedPipes.filter(
        pipe => pipe.x + Constants.PIPE_WIDTH > 0,
    );

    // Check for collisions with pipes
    const pipeCollision = processPipeCollisions(birdX, birdY, visiblePipes);

    // Check for boundary collisions
    const boundaryCollision = checkBoundaryCollision(birdY);

    // Determine if there's any collision
    const hasCollision = pipeCollision.collision || boundaryCollision.collision;
    const hitTop = pipeCollision.collision
        ? pipeCollision.hitTop
        : boundaryCollision.hitTop;

    // Handle collision consequences
    const shouldActivateBounce = hasCollision && !s.bounce.active;
    const newLives = shouldActivateBounce ? s.lives - 1 : s.lives;
    const gameEnd = newLives <= 0;
    const gameVictory = shouldEndFromScore;

    const finalBounceState = shouldActivateBounce
        ? {
              active: true,
              direction: hitTop ? ("down" as const) : ("up" as const),
              timer: newLives === 0 ? 20 : 10,
              velocity: randomBounceVelocity,
              color: true, //bird turns red upon hitting pipe
          }
        : {
              ...newBounceState,
              color: newBounceState.active ? newBounceState.color : false, // Reset after bounce
          };

    const newState = {
        ...s,
        gameEnd,
        gameVictory,
        birdPos: {
            y: Math.max(
                Birb.HEIGHT / 2,
                Math.min(
                    Viewport.CANVAS_HEIGHT - Birb.HEIGHT / 2,
                    birdY + newVelocity,
                ),
            ),
            velocity: newVelocity,
        },
        score: newScore,
        lives: newLives,
        pipes: visiblePipes,
        bounce: finalBounceState,
    };

    return recordBirdPosition(newState);
};

const createRngStream = createRngStreamFromSource(
    interval(Constants.TICK_RATE_MS),
);
const rng$ = createRngStream(Physics.SEED).pipe(
    map(randomValue => {
        // Scale from [-1, 1] to [BOUNCE_VELOCITY_MIN, BOUNCE_VELOCITY_MAX]
        return (
            Constants.BOUNCE_VELOCITY_MIN +
            ((randomValue + 1) / 2) *
                (Constants.BOUNCE_VELOCITY_MAX - Constants.BOUNCE_VELOCITY_MIN)
        );
    }),
);

/**
 * Jump function (makes the bird flap)
 */
const jump = (s: State): State =>
    s.gameEnd || s.bounce.active
        ? s
        : {
              ...s,
              birdPos: {
                  ...s.birdPos,
                  velocity: Physics.JUMP_STRENGTH,
              },
          };

/**
 * Creates an SVG element with the given properties.
 */
const createSvgElement = (
    namespace: string | null,
    name: string,
    props: Record<string, string> = {},
): SVGElement => {
    const elem = document.createElementNS(namespace, name) as SVGElement;
    Object.entries(props).forEach(([k, v]) => elem.setAttribute(k, v));
    return elem;
};

/**
 * Clear all game elements from SVG
 */
const clearGameElements = (svg: SVGSVGElement): void => {
    Array.from(svg.querySelectorAll("image, rect"))
        .filter(el => el.parentNode === svg)
        .forEach(el => svg.removeChild(el));
};

/**
 * Render a single pipe with dynamic gap height
 */
const renderPipe = (svg: SVGSVGElement, pipe: State["pipes"][0]): void => {
    // Top pipe
    const pipeTop = createSvgElement(svg.namespaceURI, "rect", {
        x: `${pipe.x}`,
        y: "0",
        width: `${Constants.PIPE_WIDTH}`,
        height: `${pipe.gapY - pipe.gapHeight / 2}`,
        fill: "green",
    });

    // Bottom pipe
    const pipeBottom = createSvgElement(svg.namespaceURI, "rect", {
        x: `${pipe.x}`,
        y: `${pipe.gapY + pipe.gapHeight / 2}`,
        width: `${Constants.PIPE_WIDTH}`,
        height: `${Viewport.CANVAS_HEIGHT - (pipe.gapY + pipe.gapHeight / 2)}`,
        fill: "green",
    });

    svg.appendChild(pipeTop);
    svg.appendChild(pipeBottom);
};

/**
 * Main render function (all side effects are here only)
 */
const render = (): ((s: State) => void) => {
    const gameOver = document.querySelector("#gameOver") as SVGElement;
    const youWin = document.querySelector("#youWin") as SVGElement;
    const livesText = document.querySelector("#livesText") as HTMLElement;
    const scoreText = document.querySelector("#scoreText") as HTMLElement;
    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;
    const restartButton = document.querySelector(
        "#restartButton",
    ) as HTMLButtonElement;

    // Set up the SVG viewport
    svg.setAttribute("width", `${Viewport.CANVAS_WIDTH}`);
    svg.setAttribute("height", `${Viewport.CANVAS_HEIGHT}`);
    svg.setAttribute(
        "viewBox",
        `0 0 ${Viewport.CANVAS_WIDTH} ${Viewport.CANVAS_HEIGHT}`,
    );

    return (s: State) => {
        // Update score and lives text
        scoreText.textContent = `Score: ${s.score}`;
        livesText.textContent = `Lives: ${s.lives}`;

        // Show/hide game over, victory messages, and restart button
        if (gameOver) {
            gameOver.style.visibility = s.gameEnd ? "visible" : "hidden";
        }
        if (youWin) {
            youWin.style.visibility = s.gameVictory ? "visible" : "hidden";
        }
        if (restartButton) {
            const shouldShow =
                s.gameEnd || s.gameVictory || s.showRestartButton;
            restartButton.style.display = shouldShow ? "block" : "none";
        }
        // Clear previous game elements (pipes, birds, and ghost birds)
        clearGameElements(svg);

        // Add ghost birds (50% opacity)
        s.ghostBirds.forEach((ghost, index) => {
            if (ghost.visible) {
                const ghostBirdImg = createSvgElement(
                    svg.namespaceURI,
                    "image",
                    {
                        href: "assets/birb.png",
                        x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`,
                        y: `${ghost.y - Birb.HEIGHT / 2}`,
                        width: `${Birb.WIDTH}`,
                        height: `${Birb.HEIGHT}`,
                        opacity: "0.5",
                        style: "pointer-events: none;",
                    },
                );
                svg.appendChild(ghostBirdImg);
            }
        });

        // Add the main bird
        const birdImg = createSvgElement(svg.namespaceURI, "image", {
            href: "assets/birb.png",
            x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`,
            y: `${s.birdPos.y - Birb.HEIGHT / 2}`,
            width: `${Birb.WIDTH}`,
            height: `${Birb.HEIGHT}`,
            style: s.bounce.color
                ? "filter: hue-rotate(300deg) saturate(10) brightness(1.2);"
                : "",
        });
        svg.appendChild(birdImg);

        // Add all pipes
        s.pipes.forEach(pipe => renderPipe(svg, pipe));
    };
};

/**
 * Main state observable
 */
export const state$ = (
    csvContents: string,
): Observable<(s: State) => State> => {
    // User input - space key
    const key$ = fromEvent<KeyboardEvent>(document, "keydown");
    const space$ = key$.pipe(
        filter(({ code }) => code === "Space"),
        map(() => jump),
    );

    // User input: mouse click
    const click$ = fromEvent(document, "click").pipe(map(() => jump));

    // Game tick
    const tick$ = interval(Constants.TICK_RATE_MS).pipe(
        withLatestFrom(rng$), // Combine with RNG values
        map(
            ([_, randomBounceVelocity]) =>
                (s: State) =>
                    tick(s, randomBounceVelocity),
        ),
    );

    // CSV pipe spawn
    const csvPipeSpawn$ = interval(Constants.TICK_RATE_MS).pipe(
        map(() => spawnPipesFromCSV),
    );

    // Ghost birds update: synchronize with the main tick
    const ghostBirdsUpdate$ = interval(Constants.TICK_RATE_MS).pipe(
        map(() => updateGhostBirds),
    );

    /**Restart button click stream */
    const restartButton = document.querySelector("#restartButton");
    const restart$ = restartButton
        ? fromEvent(restartButton, "click").pipe(map(() => restartGame))
        : of((s: State) => s);

    // Combine all streams
    return merge(
        space$,
        click$,
        tick$,
        csvPipeSpawn$,
        ghostBirdsUpdate$,
        restart$,
    );
};

// Game initialization
if (typeof window !== "undefined") {
    const { protocol, hostname, port } = new URL(import.meta.url);
    const baseUrl = `${protocol}//${hostname}${port ? `:${port}` : ""}`;
    const csvUrl = `${baseUrl}/assets/map.csv`;

    // Get the file from URL
    const csv$ = fromFetch(csvUrl).pipe(
        switchMap(response => {
            if (response.ok) {
                return response.text();
            } else {
                throw new Error(`Fetch error: ${response.status}`);
            }
        }),
        catchError(err => {
            console.error("Error fetching the CSV file:", err);
            return of("default");
        }),
    );

    // Create render function
    const renderFn = render();

    // Create a subject to trigger game restarts
    const restartTrigger$ = new Subject<void>();

    const game$ = (contents: string) => {
        // Parse CSV pipes
        const csvPipes = parseCSVPipes(contents);
        const ghostData = gameManager.getGhostData();

        // Create the initial state with all the required properties
        const createInitialState = (): State => ({
            ...initialState,
            isFirstGame: false,
            csvPipes: csvPipes,
            gameStartTime: Date.now(),
            nextPipeIndex: 0,
            ghostBirds: ghostData.map(data => ({
                y: data.birdPositions[0] || Viewport.CANVAS_HEIGHT / 2,
                visible: data.birdPositions.length > 0,
                positions: data.birdPositions,
                currentIndex: 0,
            })),
        });

        // Observable: wait for first user click
        const click$ = fromEvent(document, "click").pipe(
            take(1),
            map(() => createInitialState()),
        );

        return click$.pipe(
            switchMap(initialState => {
                return state$(contents).pipe(
                    scan((state, reducer) => {
                        const newState = reducer(state);
                        renderFn(newState);
                        return newState;
                    }, initialState),
                    takeWhile(
                        state => !state.gameEnd && !state.gameVictory,
                        true,
                    ),
                );
            }),
        );
    };

    // Start the initial game and listen for restarts
    csv$.pipe(
        switchMap(contents =>
            restartTrigger$.pipe(
                startWith(void 0), // Start immediately
                switchMap(() => game$(contents)),
            ),
        ),
    ).subscribe({
        error: err => {
            console.error("Error in game loop:", err);
        },
    });

    /**  Listen for restart button clicks to trigger new game */
    const restartButton = document.querySelector("#restartButton");
    if (restartButton) {
        fromEvent(restartButton, "click").subscribe(() => {
            restartTrigger$.next();
        });
    }
}
