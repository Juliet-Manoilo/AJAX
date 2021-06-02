import 'regenerator-runtime/runtime';

const getData = async () => {
    const res = await fetch ('https://api.themoviedb.org/3/movie/550?api_key=9db8124a79195d07277ab6cc8e55752d')
    const parsedRes = res.json();
    console.log (parsedRes);
}

getData ()

//console.log (getData);