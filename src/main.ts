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
    merge, //added
    of, //added
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
    PIPE_WIDTH: 50,
    TICK_RATE_MS: 40, // Changed from 500 to 40, for smoother movement
    PIPE_SPAWN_INTERVAL: 1500, //the time between each pipe spawn
    PIPE_SPEED: 2, //pixels per tick
    PIPE_GAP: 120, // gap between top and bottom pipes, maybe need to make random?
    SCORE_PER_PIPE: 1,
    INITIAL_LIVES: 3,
} as const;

//ADDED PHYSICS CONSTANT!!!
const Physics = {
    GRAVITY: 0.5,
    JUMP_STRENGTH: -8, //y increases downward so its negative
} as const;

// User input

//type Key = "Space";

// State processing

type State = Readonly<{
    gameEnd: boolean;
    birdPos: {
        y: number; //vertical position of birb
        velocity: number; //vertical velocity of birb
    };
    score: number;
    lives: number;
    pipes: Array<{
        id: number;
        x: number;
        gapY: number;
        passed: boolean;
    }>;
    pipeIdCounter: number;
}>;

const initialState: State = {
    gameEnd: false,
    birdPos: {
        y: Viewport.CANVAS_HEIGHT / 2, //positions the birb to the middle of the canvas
        velocity: 0, //initial velocity, birb is stationary
    },
    score: 0,
    lives: 3,
    pipes: [],
    pipeIdCounter: 0,
};

/**
 * Check if bird collides with a pipe
 */
const checkPipeCollision = (
    birdX: number,
    birdY: number,
    pipe: State["pipes"][0],
): boolean => {
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

    return topPipeCollision || bottomPipeCollision;
};

/**
 * Check if bird hits ground or ceiling
 */
const checkBoundaryCollision = (birdY: number): boolean =>
    birdY - Birb.HEIGHT / 2 <= 0 ||
    birdY + Birb.HEIGHT / 2 >= Viewport.CANVAS_HEIGHT;
/**
 * Updates the state by proceeding with one time step.
 *
 * @param s Current state
 * @returns Updated state
 */

//Added physics to the tick function !!
const tick = (s: State): State => {
    if (s.gameEnd) return s;

    const birdX = Viewport.CANVAS_WIDTH * 0.3;
    const birdY = s.birdPos.y;

    // Move pipes and update passed status
    const updatedPipes = s.pipes.map(pipe => ({
        ...pipe,
        x: pipe.x - Constants.PIPE_SPEED,
        passed:
            pipe.passed ||
            pipe.x + Constants.PIPE_WIDTH < birdX - Birb.WIDTH / 2,
    }));
    // Calculate new score - count newly passed pipes
    const newlyPassedPipes = updatedPipes.filter(
        pipe =>
            !pipe.passed &&
            pipe.x + Constants.PIPE_WIDTH < birdX - Birb.WIDTH / 2,
    );
    const newScore =
        s.score + newlyPassedPipes.length * Constants.SCORE_PER_PIPE;

    // Remove pipes that are off-screen
    const visiblePipes = updatedPipes.filter(
        pipe => pipe.x + Constants.PIPE_WIDTH > 0,
    );

    // Check for collisions with pipes
    const hasPipeCollision = visiblePipes.some(pipe =>
        checkPipeCollision(birdX, birdY, pipe),
    );
    const hasBoundaryCollision = checkBoundaryCollision(birdY);
    const hasCollision = hasPipeCollision || hasBoundaryCollision;

    // Handle collision consequences
    const newLives = hasCollision ? s.lives - 1 : s.lives;
    const gameEnd = newLives <= 0;

    return {
        ...s,
        gameEnd,
        birdPos: {
            y: Math.max(
                Birb.HEIGHT / 2,
                Math.min(
                    Viewport.CANVAS_HEIGHT - Birb.HEIGHT / 2,
                    s.birdPos.y + s.birdPos.velocity,
                ),
            ),
            velocity: s.birdPos.velocity + Physics.GRAVITY,
        },
        score: newScore,
        lives: newLives,
        pipes: visiblePipes,
    };
};

/**
 * Adds a new pipe to the state
 */
const addPipe = (s: State): State => {
    if (s.gameEnd) return s;

    const gapY = Math.random() * (Viewport.CANVAS_HEIGHT - 200) + 100;

    return {
        ...s,
        pipes: [
            ...s.pipes,
            {
                id: s.pipeIdCounter,
                x: Viewport.CANVAS_WIDTH,
                gapY,
                passed: false,
            },
        ],
        pipeIdCounter: s.pipeIdCounter + 1,
    };
};

// Rendering (side effects)

/**
 * Brings an SVG element to the foreground.
 * @param elem SVG element to bring to the foreground
 */
const bringToForeground = (elem: SVGElement): void => {
    elem.parentNode?.appendChild(elem);
};

/**
 * Displays a SVG element on the canvas. Brings to foreground.
 * @param elem SVG element to display
 */
const show = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "visible");
    bringToForeground(elem);
};

/**
 * Hides a SVG element on the canvas.
 * @param elem SVG element to hide
 */
const hide = (elem: SVGElement): void => {
    elem.setAttribute("visibility", "hidden");
};

/**
 * Creates an SVG element with the given properties.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/SVG/Element for valid
 * element names and properties.
 *
 * @param namespace Namespace of the SVG element
 * @param name SVGElement name
 * @param props Properties to set on the SVG element
 * @returns SVG element
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
    const oldElements = Array.from(svg.querySelectorAll("image, rect"));
    oldElements.forEach(el => svg.removeChild(el));
};

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

// render is what happens when the page loads
const render = (): ((s: State) => void) => {
    // Canvas elements
    const gameOver = document.querySelector("#gameOver") as SVGElement;
    const container = document.querySelector("#main") as HTMLElement;

    // Text fields
    const livesText = document.querySelector("#livesText") as HTMLElement;
    const scoreText = document.querySelector("#scoreText") as HTMLElement;

    const svg = document.querySelector("#svgCanvas") as SVGSVGElement;

    svg.setAttribute(
        "viewBox",
        `0 0 ${Viewport.CANVAS_WIDTH} ${Viewport.CANVAS_HEIGHT}`,
    );
    /**
     * Renders the current state to the canvas.
     *
     * In MVC terms, this updates the View using the Model.
     *
     * @param s Current state
     */
    return (s: State) => {
        // Update score and lives text
        scoreText.textContent = `Score: ${s.score}`;
        livesText.textContent = `Lives: ${s.lives}`;

        // Show/hide game over
        if (s.gameEnd) {
            show(gameOver);
        } else {
            hide(gameOver);
        }

        // Clear previous game elements
        clearGameElements(svg);

        // Add birb to the main grid canvas
        const birdImg = createSvgElement(svg.namespaceURI, "image", {
            href: "assets/birb.png",
            x: `${Viewport.CANVAS_WIDTH * 0.3 - Birb.WIDTH / 2}`,
            y: `${s.birdPos.y - Birb.HEIGHT / 2}`,
            width: `${Birb.WIDTH}`,
            height: `${Birb.HEIGHT}`,
        });
        svg.appendChild(birdImg);

        // Add all pipes using functional iteration
        s.pipes.forEach(pipe => renderPipe(svg, pipe));
    };
};

export const state$ = (csvContents: string): Observable<State> => {
    /** User input */
    //user presses spacebar to make the birb jump

    const key$ = fromEvent<KeyboardEvent>(document, "keypress");
    const Space$ = key$.pipe(
        filter(({ code }) => code === "Space"),
        map(() => Physics.JUMP_STRENGTH),
    );

    /** Determines the rate of time steps */
    const tick$ = interval(Constants.TICK_RATE_MS);
    const pipeSpawn$ = interval(Constants.PIPE_SPAWN_INTERVAL);

    return merge(
        Space$.pipe(
            map(velocity => (s: State) => ({
                ...s,
                birdPos: {
                    ...s.birdPos,
                    velocity: velocity, // applies the jump impulse
                },
            })),
        ),
        tick$.pipe(map(() => tick)),
        pipeSpawn$.pipe(map(() => addPipe)),
    ).pipe(scan((state, reducer) => reducer(state), initialState));
};

// The following simply runs your main function on window load.  Make sure to leave it in place.
// You should not need to change this, beware if you are.
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
    const click$ = fromEvent(document.body, "mousedown").pipe(take(1));

    // create a render function for easier code
    const renderFn = render();

    csv$.pipe(
        switchMap(contents =>
            // On click - start the game
            click$.pipe(switchMap(() => state$(contents))),
        ),
    ).subscribe(state => {
        renderFn(state);
    });
}
