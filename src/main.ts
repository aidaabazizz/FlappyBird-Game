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
    TICK_RATE_MS: 40, // speed of bird flaps
    PIPE_SPAWN_INTERVAL: 2000, //distance between each pipe, side by side
    PIPE_SPEED: 4,
    PIPE_GAP: 150, //distance between up and down pipes
    SCORE_PER_PIPE: 1,
    INITIAL_LIVES: 3,
    BOUNCE_VELOCITY_MIN: 5, // Minimum bounce velocity
    BOUNCE_VELOCITY_MAX: 9, // Maximum bounce velocity
    MAX_SCORE: 10, // the game ends after 10 points
    MAX_PIPES: 10, // only 10 pipes in the game
} as const;

const Physics = {
    GRAVITY: 0.5,
    JUMP_STRENGTH: -8,
} as const;

// State processing
type State = Readonly<{
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
}>;

const initialState: State = {
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

    return {
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
};

/**
 * Adds a new pipe to the state
 */
const addPipe = (s: State): State =>
    s.gameEnd || s.pipeIdCounter >= Constants.MAX_PIPES
        ? s
        : {
              ...s,
              pipes: [
                  ...s.pipes,
                  {
                      id: s.pipeIdCounter,
                      x: Viewport.CANVAS_WIDTH,
                      gapY:
                          Math.random() * (Viewport.CANVAS_HEIGHT - 200) + 100,
                      passed: false,
                  },
              ],
              pipeIdCounter: s.pipeIdCounter + 1,
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

        // Show/hide game over and victory messages
        if (gameOver) {
            gameOver.style.visibility = s.gameEnd ? "visible" : "hidden";
        }
        if (youWin) {
            youWin.style.visibility = s.gameVictory ? "visible" : "hidden";
        }

        // Clear previous game elements (pipes and bird)
        clearGameElements(svg);

        // Add bird using the existing image
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
 * Main state observable
 */
export const state$ = (csvContents: string): Observable<State> => {
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

    // Pipe spawn
    const pipeSpawn$ = interval(Constants.PIPE_SPAWN_INTERVAL).pipe(
        map(() => addPipe),
    );

    // Combine all streams
    return merge(space$, click$, tick$, pipeSpawn$).pipe(
        scan((state, reducer) => reducer(state), initialState),
        // End the stream when game ends or maximum score reached
        takeWhile(
            state =>
                !state.gameEnd &&
                !state.gameVictory &&
                state.score <= Constants.MAX_SCORE,
            true,
        ),
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

    // Observable: wait for first user click
    const click$ = fromEvent(document, "click").pipe(take(1));

    // Create render function
    const renderFn = render();

    // Start the game
    csv$.pipe(
        switchMap(contents => click$.pipe(switchMap(() => state$(contents)))),
    ).subscribe({
        next: state => {
            renderFn(state);
        },
        error: err => {
            console.error("Error in game loop:", err);
        },
    });
}
