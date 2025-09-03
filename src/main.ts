/**
 * Inside this file you will use the classes and functions from rx.js
 * to add visuals to the svg element in index.html, animate them, and make them interactive.
 *
 * Study and complete the tasks in observable exercises first to get ideas.
 *
 * Course Notes showing Asteroids in FRP: https://tgdwyer.github.io/asteroids/
 *
 * You will be marked on your functional programming style
 * as well as the functionality that you implement.
 *
 * Document your code!
 */

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
    tap,
} from "rxjs";
import { fromFetch } from "rxjs/fetch";

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
    PIPE_SPAWN_INTERVAL: 20, //distance between each pipe, side by side
    PIPE_SPEED: 5,
    PIPE_GAP: 150, //distance between up and down pipes
    SCORE_PER_PIPE: 1,
    INITIAL_LIVES: 3,
    BOUNCE_VELOCITY_MIN: 5, // Minimum bounce velocity
    BOUNCE_VELOCITY_MAX: 9, // Maximum bounce velocity
    MAX_SCORE: 10, // the game ends after 10 points
    MAX_PIPES: 20, // win game if passes 20 pipes/ score 20
} as const;

const Physics = {
    GRAVITY: 0.5,
    JUMP_STRENGTH: -8,
} as const;

// State processing
type State = Readonly<{
    isFirstGame: boolean;
    gameEnd: boolean;
    gameVictory: boolean;
    birdPos: {
        y: number;
        velocity: number;
    };
    score: number;
    lives: number;
    pipes: ReadonlyArray<{
        readonly id: number;
        readonly x: number;
        readonly gapY: number;
        readonly passed: boolean;
    }>;
    pipeIdCounter: number;
    bounce: {
        active: boolean;
        direction: "up" | "down";
        timer: number;
        velocity: number;
    };
    ghostBird: {
        y: number;
        visible: boolean;
    };
    previousGameData: {
        birdPositions: number[];
        currentIndex: number;
    };
    csvPipes: ReadonlyArray<{ gapY: number; spawnTime: number }>;
    gameStartTime: number;
    nextPipeIndex: number;
}>;

const initialState: State = {
    isFirstGame: true,
    gameEnd: false,
    gameVictory: false,
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
    },
    ghostBird: {
        y: Viewport.CANVAS_HEIGHT / 2,
        visible: false,
    },
    previousGameData: {
        birdPositions: [],
        currentIndex: 0,
    },
    csvPipes: [], // Initialize as empty
    gameStartTime: 0, // Will be set when game starts
    nextPipeIndex: 0, // Start from first pipe
};

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
    const pipeTopBottom = pipe.gapY - Constants.PIPE_GAP / 2;
    const pipeBottomTop = pipe.gapY + Constants.PIPE_GAP / 2;

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
): ReadonlyArray<{ gapY: number; spawnTime: number }> => {
    if (csvContent === "default") {
        // Fallback: generate some default pipes if CSV is not available
        return Array.from({ length: 10 }, (_, i) => ({
            gapY: Math.random() * (Viewport.CANVAS_HEIGHT - 200) + 100,
            spawnTime: (i + 1) * 1500, // Default timing
        }));
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
                spawnTime: time * 1000, // Convert seconds to milliseconds
            };
        });
};
/**
 * Check if bird hits ground or ceiling
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
 * Process pipe collisions using functional approach
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
 * Spawns pipes based on CSV timing data
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
 * Restart function - resets the game to initial state but keeps CSV pipes
 */
const restartGame = (s: State): State => ({
    ...initialState,
    isFirstGame: false, // A restart marks the end of the first game
    csvPipes: s.csvPipes, // Keep the CSV pipes data
    ghostBird: {
        y: Viewport.CANVAS_HEIGHT / 2,
        visible: s.ghostBird.visible,
    },
    previousGameData: {
        birdPositions: s.previousGameData.birdPositions,
        currentIndex: s.previousGameData.currentIndex,
    },
    gameStartTime: Date.now(), // Reset game start time
});

/**
 * Records the current bird position for ghost playback
 */
const recordBirdPosition = (s: State): State => {
    if (s.gameEnd) return s; // Stop recording when game ends

    return {
        ...s,
        previousGameData: {
            birdPositions: [...s.previousGameData.birdPositions, s.birdPos.y],
            currentIndex: s.previousGameData.currentIndex,
        },
    };
};

/**
 * Updates the ghost bird position based on recorded data
 */
const updateGhostBird = (s: State): State => {
    if (s.previousGameData.birdPositions.length === 0 || s.gameEnd) {
        return { ...s, ghostBird: { ...s.ghostBird, visible: false } };
    }

    const nextIndex =
        (s.previousGameData.currentIndex + 1) %
        s.previousGameData.birdPositions.length;
    const ghostY = s.previousGameData.birdPositions[nextIndex];

    return {
        ...s,
        ghostBird: {
            y: ghostY,
            visible: true,
        },
        previousGameData: {
            ...s.previousGameData,
            currentIndex: nextIndex,
        },
    };
};

/**
 * Resets ghost data when starting a new game
 */
const resetGhostData = (s: State): State => ({
    ...s,
    ghostBird: {
        y: Viewport.CANVAS_HEIGHT / 2,
        visible: false,
    },
    previousGameData: {
        birdPositions: [],
        currentIndex: 0,
    },
});

/**
 * Updates the state by proceeding with one time step.
 */
const tick = (s: State): State => {
    if (s.gameEnd || s.gameVictory) return s;

    const birdX = Viewport.CANVAS_WIDTH * 0.3;
    const birdY = s.birdPos.y;

    // Check if game should end due to max SCORE
    const shouldEndFromScore = s.score >= Constants.MAX_SCORE;

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

    // Check for collisions with pipes using functional approach
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

    // Generate random bounce velocity
    const randomBounceVelocity = shouldActivateBounce
        ? Math.floor(
              Math.random() *
                  (Constants.BOUNCE_VELOCITY_MAX -
                      Constants.BOUNCE_VELOCITY_MIN +
                      1),
          ) + Constants.BOUNCE_VELOCITY_MIN
        : s.bounce.velocity;

    const finalBounceState = shouldActivateBounce
        ? {
              active: true,
              direction: hitTop ? ("down" as const) : ("up" as const),
              timer: newLives === 0 ? 20 : 10,
              velocity: randomBounceVelocity,
          }
        : newBounceState;

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

/**
 * Jump function - makes the bird flap
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

// Rendering (side effects)

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
 * Clear all game elements from SVG using functional approach
 */
const clearGameElements = (svg: SVGSVGElement): void => {
    Array.from(svg.querySelectorAll("image, rect"))
        .filter(el => el.parentNode === svg)
        .forEach(el => svg.removeChild(el));
};

/**
 * Render a single pipe
 */
const renderPipe = (svg: SVGSVGElement, pipe: State["pipes"][0]): void => {
    // Top pipe
    const pipeTop = createSvgElement(svg.namespaceURI, "rect", {
        x: `${pipe.x}`,
        y: "0",
        width: `${Constants.PIPE_WIDTH}`,
        height: `${pipe.gapY - Constants.PIPE_GAP / 2}`,
        fill: "green",
    });

    // Bottom pipe
    const pipeBottom = createSvgElement(svg.namespaceURI, "rect", {
        x: `${pipe.x}`,
        y: `${pipe.gapY + Constants.PIPE_GAP / 2}`,
        width: `${Constants.PIPE_WIDTH}`,
        height: `${Viewport.CANVAS_HEIGHT - (pipe.gapY + Constants.PIPE_GAP / 2)}`,
        fill: "green",
    });

    svg.appendChild(pipeTop);
    svg.appendChild(pipeBottom);
};

/**
 * Main render function
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
            restartButton.style.display =
                s.gameEnd || s.gameVictory ? "block" : "none";
        }

        // Clear previous game elements (pipes and birds)
        clearGameElements(svg);

        // Add ghost bird (50% opacity) - only show if there's recorded data
        if (
            !s.isFirstGame &&
            s.ghostBird.visible &&
            s.previousGameData.birdPositions.length > 0
        ) {
            const ghostBirdImg = createSvgElement(svg.namespaceURI, "image", {
                href: "assets/birb.png",
                x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`,
                y: `${s.ghostBird.y - Birb.HEIGHT / 2}`,
                width: `${Birb.WIDTH}`,
                height: `${Birb.HEIGHT}`,
                opacity: "0.5",
            });
            svg.appendChild(ghostBirdImg);
        }

        // Add main bird using the existing image
        const birdImg = createSvgElement(svg.namespaceURI, "image", {
            href: "assets/birb.png",
            x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`,
            y: `${s.birdPos.y - Birb.HEIGHT / 2}`,
            width: `${Birb.WIDTH}`,
            height: `${Birb.HEIGHT}`,
        });
        svg.appendChild(birdImg);

        // Add all pipes using forEach (functional iteration)
        s.pipes.forEach(pipe => renderPipe(svg, pipe));
    };
};

/**
 * Main state observable (without scan)
 */
export const state$ = (
    csvContents: string,
): Observable<(s: State) => State> => {
    // Parse CSV pipes once
    const csvPipes = parseCSVPipes(csvContents);

    // User input - space key
    const key$ = fromEvent<KeyboardEvent>(document, "keydown");
    const space$ = key$.pipe(
        filter(({ code }) => code === "Space"),
        map(() => jump),
    );

    // User input - mouse click
    const click$ = fromEvent(document, "click").pipe(map(() => jump));

    // Game tick
    const tick$ = interval(Constants.TICK_RATE_MS).pipe(map(() => tick));

    // CSV pipe spawn (replace the old pipeSpawn$)
    const csvPipeSpawn$ = interval(Constants.TICK_RATE_MS).pipe(
        map(() => spawnPipesFromCSV),
    );

    // Ghost bird update
    const ghostBirdUpdate$ = interval(Constants.TICK_RATE_MS * 2).pipe(
        map(() => updateGhostBird),
    );

    // Restart button click stream
    const restartButton = document.querySelector("#restartButton");
    const restart$ = restartButton
        ? fromEvent(restartButton, "click").pipe(map(() => restartGame))
        : of((s: State) => s);

    // Combine all streams WITHOUT scan
    return merge(
        space$,
        click$,
        tick$,
        csvPipeSpawn$, // Use CSV pipe spawn instead of random
        ghostBirdUpdate$,
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

    // Main game stream that can be restarted
    const game$ = (contents: string) => {
        // Parse CSV pipes
        const csvPipes = parseCSVPipes(contents);

        // Observable: wait for first user click
        const click$ = fromEvent(document, "click").pipe(
            take(1),
            map(() => (s: State) => ({
                ...resetGhostData(s),
                csvPipes: csvPipes,
                gameStartTime: Date.now(),
                nextPipeIndex: 0,
            })),
        );

        return click$.pipe(
            switchMap(initialReducer => {
                let currentState = initialReducer(initialState);

                return state$(contents).pipe(
                    scan((state, reducer) => reducer(state), currentState),
                    tap(state => renderFn(state)),
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

    // Listen for restart button clicks to trigger new game
    const restartButton = document.querySelector("#restartButton");
    if (restartButton) {
        fromEvent(restartButton, "click").subscribe(() => {
            restartTrigger$.next();
        });
    }
}
